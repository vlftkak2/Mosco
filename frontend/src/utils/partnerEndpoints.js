// FastAPI 거래처 API URL 계약. 백엔드 준비 후 이 경로에 axios 요청을 연결하면 됩니다.
export const partnerEndpoints = {
  list: '/api/partners',
  create: '/api/partners',
  detail: (partnerCode) => `/api/partners/${encodeURIComponent(partnerCode)}`,
  update: (partnerCode) => `/api/partners/${encodeURIComponent(partnerCode)}`,
  delete: (partnerCode) => `/api/partners/${encodeURIComponent(partnerCode)}`,
};
