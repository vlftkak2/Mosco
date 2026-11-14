// 서버 오류 응답을 알림 문구로 바꾼다.
// 입력값 오류(422)는 서버가 한글 사유(msg)와 위치(loc)를 주므로, 위치의 칸 이름을 앞에 붙인다. 예) "이메일: 3자 이상 입력해 주세요."
const FIELD_LABELS = {
  companyid: '고객사 코드', companyname: '고객사명', businessno: '사업자번호', ceoname: '대표자명', phone: '전화번호',
  zipcode: '우편번호', address1: '주소', address2: '상세주소', plan_code: '서비스 유형', company_status: '이용 상태',
  licensed_seats: '허용 계정 수', username: '사용자명', email: '이메일', original_email: '기존 이메일', password: '비밀번호',
  authority: '권한', useyn: '사용여부', useremail: '사용자 이메일', menuids: '메뉴', empno: '사원번호', team: '부서',
  position: '직급', worktype: '근무유형', birthdate: '생년월일', mobile: '휴대폰번호', hiredate: '입사일', retiredate: '퇴사일',
  photo: '사진', keyword: '검색어', q: '검색어',
};

export function apiErrorMessage(error, fallback = '요청을 처리하지 못했습니다.', labels = {}) {
  if (!error?.response) return error?.message && !/^Network Error$/i.test(error.message) ? error.message : '서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  const detail = error.response.data?.detail;
  if (Array.isArray(detail)) {
    const lines = detail.map((item) => {
      const field = Array.isArray(item?.loc) ? [...item.loc].reverse().find((part) => typeof part === 'string' && part !== 'body') : '';
      const label = labels[field] || FIELD_LABELS[field];
      const reason = String(item?.msg || '입력값을 확인해 주세요.').replace(/^Value error,\s*/i, '');
      return label ? `${label}: ${reason}` : reason;
    });
    return [...new Set(lines)].slice(0, 3).join(' / ') || fallback;
  }
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (error.response.status === 403) return '이 작업을 할 권한이 없습니다.';
  if (error.response.status === 401) return '로그인이 만료되었습니다. 다시 로그인해 주세요.';
  return fallback;
}
