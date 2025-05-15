```bash
mkdir -p ./data/chroma

docker run -d \
  --name chromadb \
  -p 8000:8000 \
  -v ${PWD}/data/chroma:/data \
  --restart unless-stopped \
  chromadb/chroma:latest

```
