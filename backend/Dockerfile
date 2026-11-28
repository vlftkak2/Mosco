FROM python:3.11-slim

# 파이썬 바이트코드(.pyc) 미생성, 로그 즉시 출력 (docker logs 에 바로 보이도록)
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# DB는 psycopg2-binary(PostgreSQL)만 사용하므로 MS SQL ODBC 드라이버(msodbcsql17/unixodbc)는 설치하지 않는다.

# root 가 아닌 전용 계정으로 실행 (임시 파일은 /tmp 만 사용)
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home --shell /usr/sbin/nologin app

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=app:app . .

USER app

EXPOSE 8000

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
