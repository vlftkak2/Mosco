"""상담게시판 API — 로그인한 모든 계정이 쓰는 공통 메뉴 (권한은 Board.py 에서 회사 기준으로 판단)."""
from fastapi import APIRouter, Body, Depends, Query
from security import get_current_user
from services.system import Board

router = APIRouter(prefix='/api/board', tags=['board'])


@router.get('')
def list_posts(category: Board.Category = 'notice', keyword: str = Query('', max_length=200),
               status: Board.Status = '', page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
               user: dict = Depends(get_current_user)):
    return Board.list_posts(user, category, keyword.strip(), page, page_size, status)


@router.get('/summary')
def summary(user: dict = Depends(get_current_user)):
    return Board.summary(user)


@router.post('', status_code=201)
def create_post(data: Board.PostInput, user: dict = Depends(get_current_user)):
    return {'item': Board.create_post(user, data)}


@router.get('/{post_id}')
def get_post(post_id: int, user: dict = Depends(get_current_user)):
    return {'item': Board.get_post(user, post_id)}


@router.put('/{post_id}')
def update_post(post_id: int, data: Board.PostInput, user: dict = Depends(get_current_user)):
    return {'item': Board.update_post(user, post_id, data)}


@router.delete('/{post_id}')
def delete_post(post_id: int, user: dict = Depends(get_current_user)):
    Board.delete_post(user, post_id)
    return {'success': True}


@router.put('/{post_id}/pin')
def set_pinned(post_id: int, pinned: bool = Body(..., embed=True), user: dict = Depends(get_current_user)):
    return {'item': Board.set_pinned(user, post_id, pinned)}


@router.post('/{post_id}/replies', status_code=201)
@router.put('/{post_id}/reply', deprecated=True)
def save_reply(post_id: int, data: Board.ReplyInput, user: dict = Depends(get_current_user)):
    return {'item': Board.save_reply(user, post_id, data)}


@router.put('/{post_id}/replies/{reply_id}')
def update_reply(post_id: int, reply_id: int, data: Board.ReplyInput, user: dict = Depends(get_current_user)):
    return {'item': Board.update_reply(user, post_id, reply_id, data)}


@router.delete('/{post_id}/replies/{reply_id}')
def delete_reply(post_id: int, reply_id: int, user: dict = Depends(get_current_user)):
    return {'item': Board.delete_reply(user, post_id, reply_id)}
