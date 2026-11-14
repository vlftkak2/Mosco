import unittest
from unittest.mock import MagicMock, patch

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import ValidationError

from routes.system.Board_routes import router
from security import get_current_user
from services.system import Board


def user(company):
    return dict(companyid=company, companyname='회사', username='사용자', email='user@example.com')


class BoardTests(unittest.TestCase):
    def setUp(self):
        self.admin = user('001')
        self.tenant = user('002')
        self.post = dict(id=1, companyid='002', category='stock', reply='')

    def test_creation_matrix(self):
        for category in ('notice', 'ai', 'stock', 'system'):
            self.assertTrue(Board.can_create(self.admin, category))  # 운영사는 모든 탭 (재고 · 시스템은 시험용)
            self.assertEqual(Board.can_create(self.tenant, category), category in ('stock', 'system'))

    def test_company_permissions(self):
        self.assertTrue(Board.permissions(self.post, self.tenant)['can_edit'])
        self.assertFalse(Board.permissions(self.post, user('003'))['can_edit'])
        self.assertTrue(Board.permissions(self.post, self.tenant)['can_reply'])
        self.assertFalse(Board.permissions(self.post, user('003'))['can_reply'])
        self.assertFalse(Board.permissions(dict(self.post, category='notice', companyid='001'), self.tenant)['can_reply'])
        self.assertTrue(Board.permissions(self.post, self.admin)['can_reply'])
        self.assertFalse(Board.permissions(self.post, self.admin)['can_edit'])

    def test_tenant_detail_is_scoped_and_missing_is_404(self):
        cursor = MagicMock()
        cursor.fetchone.return_value = None
        with self.assertRaises(HTTPException) as error:
            Board.find_post(cursor, 99, self.tenant)
        self.assertEqual(error.exception.status_code, 404)
        sql, args = cursor.execute.call_args.args
        self.assertIn('companyid = %s', sql)
        self.assertEqual(args, [99, '002'])

    def test_list_scopes_search_and_pagination(self):
        with patch.object(Board, 'connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = {'total': 0}
            cursor.fetchall.return_value = []
            Board.list_posts(self.tenant, 'stock', '%', 2, 20)
            sql, args = cursor.execute.call_args.args
            self.assertIn('companyid = %s', sql)
            self.assertEqual(args, ['002', 'stock', '%\\%%', '%\\%%', 20, 20])

    def test_forbidden_create_does_not_connect(self):
        with patch.object(Board, 'connect') as connect:
            with self.assertRaises(HTTPException) as error:
                Board.create_post(self.tenant, Board.PostInput(category='notice', title='제목', content='내용'))
            self.assertEqual(error.exception.status_code, 403)
            connect.assert_not_called()

    def test_server_checks_write_permissions(self):
        for action, actor in [(Board.update_post, self.admin), (Board.delete_post, self.admin), (Board.save_reply, user('003'))]:
            with self.subTest(action=action.__name__), patch.object(Board, 'connect'), patch.object(Board, 'find_post', return_value=Board.permissions(self.post, actor)):
                args = [actor, 1]
                if action == Board.update_post:
                    args.append(Board.PostInput(category='stock', title='제목', content='내용'))
                if action == Board.save_reply:
                    args.append(Board.ReplyInput(reply='답변'))
                with self.assertRaises(HTTPException) as error:
                    action(*args)
                self.assertEqual(error.exception.status_code, 403)

    def test_replies_append_and_preserve_history(self):
        for actor in (self.admin, self.tenant):
            with self.subTest(company=actor['companyid']), patch.object(Board, 'connect') as connect:
                cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
                cursor.fetchone.return_value = self.post
                cursor.fetchall.return_value = [{'id': 1, 'content': 'previous'}, {'id': 2, 'content': 'new'}]
                item = Board.save_reply(actor, 1, Board.ReplyInput(reply='new'))
                self.assertEqual(len(item['replies']), 2)
                inserts = [call.args for call in cursor.execute.call_args_list if 'INSERT INTO boardreply01t' in call.args[0]]
                self.assertEqual(len(inserts), 1)
                self.assertEqual(inserts[0][1], (1, actor['companyid'], actor['companyname'], actor['email'], actor['username'], 'new'))
                self.assertFalse(any('UPDATE boardreply01t' in call.args[0] for call in cursor.execute.call_args_list))

    def test_invalid_input(self):
        for fields in [dict(title='  '), dict(content='\n '), dict(title='x' * 201), dict(companyid='001'), dict(category='unknown')]:
            with self.subTest(fields=fields), self.assertRaises(ValidationError):
                Board.PostInput(**(dict(category='stock', title='제목', content='내용') | fields))
        with self.assertRaises(ValidationError):
            Board.ReplyInput(reply='  ')

    def test_api_validation_and_auth(self):
        app = FastAPI()
        app.include_router(router)
        client = TestClient(app)
        self.assertIn(client.get('/api/board').status_code, (401, 503))
        app.dependency_overrides[get_current_user] = lambda: self.tenant
        self.assertEqual(client.get('/api/board?page=0').status_code, 422)
        self.assertEqual(client.get('/api/board?category=invalid').status_code, 422)
        self.assertEqual(client.post('/api/board', json=dict(category='notice', title='공지', content='내용')).status_code, 403)
        with patch.object(Board, 'create_post', return_value=self.post) as create:
            self.assertEqual(client.post('/api/board', json=dict(category='stock', title='문의', content='내용')).status_code, 201)
            self.assertEqual(create.call_args.args[0]['companyid'], '002')


    def test_pin_permission_only_operator_on_managed_tabs(self):
        self.assertTrue(Board.permissions(dict(self.post, category='notice', companyid='001'), self.admin)['can_pin'])
        self.assertFalse(Board.permissions(dict(self.post, category='notice', companyid='001'), self.tenant)['can_pin'])
        self.assertFalse(Board.permissions(self.post, self.admin)['can_pin'])
        self.assertFalse(Board.permissions(dict(self.post, category='ai', companyid='001'), self.admin)['can_pin'])

    def test_notice_has_no_replies_even_for_operator(self):
        notice = dict(self.post, category='notice', companyid='001')
        self.assertFalse(Board.permissions(notice, self.admin)['can_reply'])
        self.assertTrue(Board.permissions(notice, self.admin)['can_edit'])
        self.assertFalse(Board.permissions(dict(self.post, category='ai', companyid='001'), self.admin)['can_reply'])  # AI ERP문의도 답글 없음

    def test_tenant_cannot_see_operator_tabs(self):
        scope, args = Board.visibility(self.tenant)
        self.assertIn("category IN ('stock', 'system')", scope)
        self.assertEqual(args, ['002'])
        self.assertEqual(Board.visible_categories(self.tenant), ('stock', 'system'))
        self.assertEqual(Board.visible_categories(self.admin), ('notice', 'stock', 'ai', 'system'))

    def test_reply_edit_delete_permissions(self):
        mine = dict(companyid='002', created_by='user@example.com')
        other = dict(companyid='002', created_by='other@example.com')
        self.assertTrue(Board.reply_can_edit(mine, self.tenant))
        self.assertFalse(Board.reply_can_edit(other, self.tenant))
        self.assertFalse(Board.reply_can_delete(other, self.tenant))
        self.assertFalse(Board.reply_can_edit(other, self.admin))
        self.assertTrue(Board.reply_can_delete(other, self.admin))

    def test_status_follows_last_reply(self):
        cursor = MagicMock()
        for replies, expected in [([], 'waiting'), ([dict(companyid='001')], 'answered'),
                                  ([dict(companyid='001'), dict(companyid='002')], 'followup')]:
            with self.subTest(expected=expected):
                cursor.fetchall.return_value = replies
                self.assertEqual(Board.with_replies(cursor, dict(id=1, category='stock'))['status'], expected)
        cursor.fetchall.return_value = []
        self.assertEqual(Board.with_replies(cursor, dict(id=1, category='notice'))['status'], 'notice')
        self.assertEqual(Board.with_replies(cursor, dict(id=1, category='ai'))['status'], 'ai')  # AI ERP문의는 '접수'

    def test_status_filter_and_summary_scope(self):
        with patch.object(Board, 'connect') as connect:
            cursor = connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = {'total': 0}
            cursor.fetchall.return_value = []
            Board.list_posts(self.tenant, 'stock', '', 1, 20, 'followup')
            sql, args = cursor.execute.call_args.args
            self.assertIn('= %s', sql)
            self.assertEqual(args, ['002', 'stock', 'followup', 20, 0])
            Board.list_posts(self.admin, 'notice', '', 1, 20, 'waiting')
            self.assertEqual(cursor.execute.call_args.args[1], ['notice', 20, 0])  # 공지사항엔 상태 필터 없음
            result = Board.summary(self.tenant)
            self.assertIn('companyid = %s', cursor.execute.call_args.args[0])
            self.assertEqual(set(result['categories']), {'stock', 'system'})  # 다른 회사는 공지 · AI ERP 탭 없음


if __name__ == '__main__':
    unittest.main()
