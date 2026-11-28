import { Component } from 'react';

/**
 * 화면 그리기 오류 막이.
 * 한 화면(탭)에서 오류가 나도 앱 전체가 하얗게 되지 않고, 그 자리에만 안내 문구와 [다시 시도]를 보인다.
 *  resetKey : 값이 바뀌면 오류 상태를 풀고 다시 그린다 (예: 화면 경로)
 *  fullPage : 앱 전체를 감쌀 때 (화면 가운데 크게)
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, resetKey: props.resetKey };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  static getDerivedStateFromProps(props, state) {
    if (props.resetKey !== state.resetKey) return { error: null, resetKey: props.resetKey };
    return null;
  }

  componentDidCatch(error, info) {
    console.error('화면 오류:', error, info?.componentStack);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;
    const { fullPage = false } = this.props;
    // 새 버전 배포 뒤 옛 화면 파일을 못 받는 경우는 새로고침해야 풀린다
    const chunkError = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(String(this.state.error?.message || ''));
    return (
      <div role="alert" style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12,
        minHeight: fullPage ? '100vh' : 240, padding: 24, textAlign: 'center', color: '#343a40',
      }}>
        <strong style={{ fontSize: 16 }}>화면을 표시하는 중 오류가 발생했습니다.</strong>
        <span style={{ fontSize: 13, color: '#868e96' }}>
          {chunkError ? '새 버전이 배포되었을 수 있습니다. 새로고침해 주세요.' : '다시 시도해도 같으면 화면을 닫았다가 다시 열어 주세요.'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={this.retry} style={{
            height: 32, padding: '0 16px', border: 'none', borderRadius: 6, background: '#e03131', color: '#fff', fontSize: 13, cursor: 'pointer',
          }}>다시 시도</button>
          {(fullPage || chunkError) && (
            <button type="button" onClick={() => window.location.reload()} style={{
              height: 32, padding: '0 16px', border: '1px solid #dee2e6', borderRadius: 6, background: '#fff', color: '#343a40', fontSize: 13, cursor: 'pointer',
            }}>새로고침</button>
          )}
        </div>
      </div>
    );
  }
}
