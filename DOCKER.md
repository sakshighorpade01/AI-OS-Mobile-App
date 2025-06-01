# Docker Guide for AI-OS

This document summarizes all Docker-related steps, fixes, and best practices for running the AI-OS project, especially for enabling multimodal file access (images, audio, video, PDFs, etc.) with the Agno framework.

---

## 1. Dockerfile and Image Build

- The backend is run in a Docker container using a `Dockerfile` in the project root.
- The Docker image installs all Python dependencies from `requirements.txt`.
- The container exposes the backend on port 8765 by default.

**Example Dockerfile excerpt:**
```dockerfile
FROM python:3.10-slim
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
EXPOSE 8765
CMD ["python", "python-backend/app.py"]
```

---

## 2. Environment Variables

- Set API keys and other secrets in a `.env` file in the project root.
- Example:
  ```env
  OPENAI_API_KEY=sk-...
  GROQ_API_KEY=...
  # Add any other required keys
  ```
- The backend loads these automatically using `python-dotenv`.

---

## 3. File Mounting for Multimodal Inputs

**Critical for multimodal support:**
- The Electron frontend passes file paths (e.g., for images, audio, video, PDFs) to the backend.
- The backend container must have access to the same file paths as the host system.
- **Mount the host's user files directory into the container** using Docker's `-v` flag.

**Example (Windows):**
```sh
docker run -it --rm -p 8765:8765 -v C:/Users/youruser/Downloads:/host_downloads ai-os-image
```
- In the app, ensure file paths are referenced as `/host_downloads/filename.ext` inside the container.
- You may need to adjust the frontend to rewrite Windows paths to the mounted path inside the container.

---

## 4. Troubleshooting Multimodal File Access

- If the LLM says it cannot find a file, check:
  - The file path sent from the frontend matches the mounted path in the container.
  - The file exists inside the container at the expected location (`docker exec -it <container> ls /host_downloads`).
  - The backend logs for path normalization and file existence checks.
- For Windows, always use forward slashes in Docker volume mounts and inside the container.
- If you see errors like `File does not exist at path: ...`, check the path mapping and normalization logic in `app.py`.

---

## 5. Best Practices

- Always mount user-accessible directories (Downloads, Documents, etc.) into the container if you want to process files from those locations.
- Use absolute paths in the frontend and rewrite them as needed for the container's mount points.
- Keep your `.env` file out of version control (`.gitignore`) and use Docker secrets for production.
- For debugging, use `docker exec -it <container> bash` to inspect files and logs inside the running container.

---

## 6. Example Docker Compose (Optional)

If you want to use Docker Compose for easier management:

```yaml
version: '3.8'
services:
  ai-os-backend:
    build: .
    ports:
      - "8765:8765"
    env_file:
      - .env
    volumes:
      - C:/Users/youruser/Downloads:/host_downloads
```

---

## 7. Additional Notes

- If you update the backend code, rebuild the Docker image: `docker build -t ai-os-image .`
- If you change the requirements, rebuild the image as well.
- For persistent storage (e.g., session logs), mount a host directory to `/app/tmp` or similar.

---

**For more details, see the main README and comments in the Dockerfile.** 