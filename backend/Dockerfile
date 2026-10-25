FROM python:3.11-slim

# 1. 필수 라이브러리 설치 (gnupg, 정식 키 등록 방식)
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    unixodbc-dev \
    && curl https://packages.microsoft.com/keys/microsoft.asc | gpg --dearmor -o /usr/share/keyrings/microsoft-prod.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/microsoft-prod.gpg] https://packages.microsoft.com/debian/11/prod bullseye main" > /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update \
    && ACCEPT_EULA=Y apt-get install -y msodbcsql17

# 2. 드라이버 경로 강제 연결 (심볼릭 링크)
RUN ln -s /opt/microsoft/msodbcsql17/lib64/libmsodbcsql-17.so /usr/lib/libmsodbcsql-17.so || true

# 3. odbcinst.ini 설정 (pyodbc가 바로 찾을 수 있게 이름 고정)
RUN echo "[SQL Server]\nDriver=/usr/lib/libmsodbcsql-17.so\nUsageCount=1" > /etc/odbcinst.ini

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
