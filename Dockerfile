# Linux 部署：docker build -t iol-helper . && docker run -p 8766:8766 iol-helper
# 只用 Python 標準函式庫；OCR 預設在使用者瀏覽器內執行。
FROM python:3.12-slim
WORKDIR /srv/iol
COPY server ./server
COPY app ./app
COPY formulas ./formulas
ENV IOL_HOST=0.0.0.0 IOL_PORT=8766
EXPOSE 8766
USER nobody
CMD ["python3", "server/server.py"]
