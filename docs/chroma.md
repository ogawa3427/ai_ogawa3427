```bash
mkdir -p ./data/chroma

docker run -d \
  --name chromadb \
  -p 8000:8000 \
  -v ${PWD}/data/chroma:/data \
  --restart unless-stopped \
  chromadb/chroma:latest

# 2つ目のChromaDBインスタンス
docker run -d \
  --name chromadb-meta \
  -p 8001:8000 \
  -v ${PWD}/data/chroma2:/data \
  --restart unless-stopped \
  chromadb/chroma:latest
