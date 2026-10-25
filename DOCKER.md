# Mosco Docker 배포

Docker는 앱 코드를 컨테이너 이미지에 담습니다. 배포 PC는 GitHub의 `mosco` 브랜치를 받아 이미지를 빌드하므로, 소스 파일을 직접 복사할 필요가 없습니다.

## 처음 한 번 설정

1. 배포 PC에 Docker Desktop을 설치하고 실행합니다.
2. PowerShell에서 저장소를 받습니다.

   ```powershell
   git clone --branch mosco --single-branch https://github.com/vlftkak2/Mosco.git C:\Mosco
   Set-Location C:\Mosco
   ```

3. 환경 설정 파일을 만들고 엽니다.

   ```powershell
   Copy-Item backend/.env.example backend/.env
   notepad backend/.env
   ```

4. `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `JWT_SECRET_KEY`를 배포 환경 값으로 설정합니다. DB가 배포 PC에 설치되어 있으면 `DB_HOST=host.docker.internal`을 사용합니다. 다른 서버에 있으면 그 서버의 주소를 입력합니다. AI 주문서 분석을 쓰면 `OPENAI_API_KEY`도 입력합니다.
5. 처음 실행합니다.

   ```powershell
   docker compose up --build --detach
   docker compose ps
   ```

브라우저에서 `http://localhost`를 열어 확인합니다. 외부 PC에서 접속하려면 배포 PC의 방화벽에서 HTTP 포트 80을 허용하고 `http://배포PC주소`로 접속합니다.

## 코드 업데이트

개발 PC에서 커밋한 내용을 GitHub `Mosco` 저장소의 `mosco` 브랜치로 푸시한 뒤, 배포 PC의 저장소 폴더에서 다음을 실행합니다.

```powershell
.\deploy.ps1
```

이 스크립트는 `mosco` 브랜치의 최신 소스를 받아 프론트엔드와 백엔드 이미지를 다시 만들고 컨테이너를 교체합니다. `backend/.env`와 Docker 볼륨의 AI 사용량 기록은 컨테이너 교체 후에도 유지됩니다.

## 운영 구성

- PostgreSQL은 기존 DB를 계속 사용하며 Docker가 새 DB를 만들거나 초기화하지 않습니다.
- 백엔드는 프론트엔드와 Nginx를 통해서만 접근합니다.
- 소스의 `.env` 파일은 이미지에 복사하지 않습니다. 각 배포 PC의 `backend/.env`에서 실행 설정을 전달합니다.
- 기본 웹 포트는 80입니다. 이미 사용 중이면 배포 폴더에 `.env` 파일을 만들고 `HTTP_PORT=8080`처럼 지정할 수 있습니다.

로그와 상태를 확인하려면 다음을 사용합니다.

```powershell
docker compose ps
docker compose logs -f backend
docker compose logs -f nginx
```
