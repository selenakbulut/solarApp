"""Backend entrypoint: python -m uvicorn api:app --reload"""
from backend.application import create_app

app = create_app()
