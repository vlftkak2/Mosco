import { 
  TextInput, 
  PasswordInput, 
  Checkbox, 
  Button, 
  Text, 
  Container, 
  Box,
  Stack
} from '@mantine/core';
import { useForm } from '@mantine/form';

import classes from '../../styles/auth/LoginPage.module.css';
import axios from 'axios'

function LoginPage() {
  const form = useForm({
    initialValues: { email: '', password: '', rememberMe: false },
    validate: {
      email: (value) => (/^\S+@\S+$/.test(value) ? null : '이메일 형식이 올바르지 않습니다'),
      password: (value) => (value.length < 4 ? '비밀번호가 너무 짧습니다' : null),
    },
  });

const handleLogin = async (values) => {
  try {
    // 1. FastAPI 서버 주소로 POST 요청을 보냅니다.
    // 두 번째 인자인 values에는 { email, password }가 들어있어야 합니다.
    const response = await axios.post(`http://${window.location.hostname}/api/login`, { //'http://127.0.0.1:8000/api/login' //`http://${window.location.hostname}:8000/api/login`
      email: values.email,
      password: values.password
    });

    // 2. 서버 응답 처리 (성공 시)
    // FastAPI에서 return {"success": True, ...}를 보냈으므로 response.data에 담깁니다.
    if (response.data.success) {
      console.log('로그인 성공:', response.data.user_email);
      
      // Browser Local Storage Save
      localStorage.setItem('user_name',response.data.user_name);
      localStorage.setItem('user_email',response.data.user_email)
      
      // 로그인 후에는 서버에서 최신 정적 파일을 다시 받도록 전체 페이지 이동을 사용합니다.
      window.location.assign('/HomePage');
    }
  } catch (error) { 
    // 3. 에러 처리 (로그인 실패 또는 서버 오류)
    if (error.response) {
      // 서버가 응답을 보냈으나 401(인증실패) 등의 에러인 경우
      console.error('로그인 실패:', error.response.data.detail);
      form.setErrors({ email: error.response.data.detail || '이메일 또는 비밀번호가 틀렸습니다.' });
    } else {
      // 서버 자체가 죽어있거나 연결이 안 되는 경우
      console.error('서버 연결 오류:', error.message);
      alert('현재 서버와 통신할 수 없습니다.');
    }
  }
};

  return (
    <Box className={classes.pageWrapper}>
      <Container size={550} w="100%">
        
        <Box>
          <h1 className={classes.title}>스틸 119</h1>
          <p className={classes.subtitle}>이메일 계정으로 접속해 주세요.</p>
        </Box>

        <Box className={classes.loginCard}>
          <form onSubmit={form.onSubmit(handleLogin)}>
            <Stack gap="xl">
              <TextInput 
                label="이메일 주소" 
                placeholder="hmchoi@apr-in.com" 
                size="lg" 
                {...form.getInputProps('email')}
              />
              
              <Box>
                <PasswordInput 
                  label="비밀번호" 
                  placeholder="비밀번호 입력" 
                  size="lg" 
                  {...form.getInputProps('password')} 
                />
 
              </Box>

              <Checkbox 
                label="로그인 상태 유지" 
                size="md"
                {...form.getInputProps('rememberMe', { type: 'checkbox' })} 
              />

              <Button type="submit" fullWidth className={classes.loginButton} size="xl">
                로그인
              </Button>
            </Stack>
          </form>
        </Box>

        <Text ta="center" mt={40} c="dimmed" size="md">
          © Portal System. Made By ERP Team
        </Text>
      </Container>
    </Box>
  );
}

export default LoginPage;
