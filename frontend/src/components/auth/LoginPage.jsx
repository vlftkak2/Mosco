import { 
  TextInput, 
  PasswordInput, 
  Checkbox, 
  Button, 
  Text, 
  Box,
  Stack,
  Select
} from '@mantine/core';
import { useForm } from '@mantine/form';
import classes from '../../styles/auth/LoginPage.module.css';
import axios from 'axios';
import steel119Logo from '../../assets/img/steel119-login.png';

function LoginPage() {
  const rememberedEmail = localStorage.getItem('remembered_email') || '';
  const form = useForm({
    initialValues: { company: '', email: rememberedEmail, password: '', rememberMe: Boolean(rememberedEmail) },
    validate: {
      email: (value) => (/^\S+@\S+$/.test(value) ? null : '이메일 형식이 올바르지 않습니다'),
      password: (value) => (value.length < 4 ? '비밀번호가 너무 짧습니다' : null),
    },
  });

  const handleLogin = async (values) => {
    if (values.rememberMe) {
      localStorage.setItem('remembered_email', values.email);
    } else {
      localStorage.removeItem('remembered_email');
    }

    try {

      // axios.get(`http://${window.location.hostname}/api/login`)
      const response = await axios.post('/api/login', {
        company: values.company,
        email: values.email,
        password: values.password
      });

      if (response.data.success) {

        console.log('로그인 성공:', response.data.user_email);
        localStorage.setItem('user_name', response.data.user_name);
        localStorage.setItem('user_email', response.data.user_email);
        localStorage.setItem('user_company', response.data.user_company);
        localStorage.setItem('user_companyname', response.data.user_companyname);
        localStorage.setItem('user_authority', response.data.user_authority || 'USER');
        localStorage.setItem('access_token', response.data.access_token);
        window.location.assign('/HomePage');
      }
    } catch (error) { 
      if (error.response) {
        console.error('로그인 실패:', error.response.data.detail);
        form.setErrors({ email: error.response.data.detail || '이메일 또는 비밀번호가 틀렸습니다.' });
      } else {
        console.error('서버 연결 오류:', error.message);
        alert('현재 서버와 통신할 수 없습니다.');
      }
    }
  };

  return (
    <Box className={classes.pageWrapper}>
      <Box className={classes.mainContainer}>
        <Box className={classes.leftPanel}>
          <Box className={classes.brandContent}>
            <div className={classes.brandTopline}>
              <img className={classes.leftBrandLogo} src={steel119Logo} alt="STEEL 119" />
            </div>
            <div className={classes.brandMessage}>
              <div className={classes.brandAccentLine} aria-hidden="true" />
              <h1 className={classes.brandTitle}>철강 비즈니스의 흐름을<br />한 곳에서 관리하다</h1>
              {/* <Text className={classes.brandEyebrow}>GLOBAL ORDER MANAGEMENT SYSTEM</Text> */}
              
              <Text className={classes.brandDescription}>
                주문부터 재고, 물류관리까지 <br/ >스틸119 비즈니스 포털 하나로 해결하세요.
              </Text>
            </div>

          </Box>
        </Box>

        <Box className={classes.rightPanel}>
          <Box className={classes.formWrapper}>

            <Box mb={32}>
              <Text className={classes.signInLabel} c="#dc2626">SIGN IN</Text>
              <h1 className={classes.loginHeaderTitle}>로그인</h1>
              <Text className={classes.loginDescription}>등록된 비즈니스 계정으로 로그인해 주세요.</Text>
            </Box>

            <form onSubmit={form.onSubmit(handleLogin)}>
              <Stack gap={20}>
                <TextInput 
                  label="이메일"
                  placeholder="이메일 입력"
                  size="md" 
                  radius="sm"
                  autoComplete="username"
                  {...form.getInputProps('email')}
                />
                
                <PasswordInput 
                  label="비밀번호"
                  placeholder="비밀번호 입력" 
                  size="md" 
                  radius="sm"
                  autoComplete="current-password"
                  {...form.getInputProps('password')} 
                />

                <div className={classes.formOptions}>
                  <Checkbox
                    label="아이디 저장"
                    size="sm"
                    {...form.getInputProps('rememberMe', { type: 'checkbox' })}
                  />

                </div>

                <Button 
                  type="submit" 
                  fullWidth 
                  size="md"
                  radius="sm"
                  className={classes.loginButton}
                >
                  로그인
                </Button>
              </Stack>
            </form>

            <div className={classes.footerDivider} />
            <Text ta="center" c="#868e96" className={classes.footerText}>
              <br/>©2026. MOSCO. All Rights Reserved.
            </Text>
          </Box>
        </Box>

      </Box>
    </Box>
  );
}

export default LoginPage;
