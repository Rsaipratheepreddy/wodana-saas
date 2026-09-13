FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
WORKDIR /app

COPY pyproject.toml ./
COPY src ./src
RUN pip install --no-cache-dir .

USER nobody
EXPOSE 8001
CMD ["uvicorn", "wodana_intelligence.main:app", "--host", "0.0.0.0", "--port", "8001"]

