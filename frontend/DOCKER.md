# Frontend Docker Setup

This document explains how to build and run the SplitNaira frontend using Docker.

## Building the Docker Image

```bash
# From the frontend directory
docker build -t splitnaira-frontend .

# Or from the project root
docker build -t splitnaira-frontend -f frontend/Dockerfile frontend/
```

## Running the Container

### Basic Run

```bash
docker run -p 3000:3000 splitnaira-frontend
```

### With Environment Variables

```bash
docker run -p 3000:3000 \
  -e NEXT_PUBLIC_API_URL=https://api.splitnaira.com \
  -e NEXT_PUBLIC_STELLAR_NETWORK=testnet \
  splitnaira-frontend
```

### With Environment File

```bash
docker run -p 3000:3000 --env-file .env.local splitnaira-frontend
```

## Docker Compose (Optional)

Create a `docker-compose.yml` in the project root:

```yaml
version: '3.8'

services:
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NEXT_PUBLIC_API_URL=http://localhost:3001
      - NEXT_PUBLIC_STELLAR_NETWORK=testnet
    restart: unless-stopped
```

Run with:

```bash
docker-compose up -d
```

## Multi-Stage Build Explanation

The Dockerfile uses a multi-stage build process:

1. **deps**: Installs dependencies using `npm ci` for reproducible builds
2. **builder**: Builds the Next.js application with standalone output
3. **runner**: Creates a minimal production image with only necessary files

This approach:
- Reduces final image size
- Improves security by running as non-root user
- Optimizes for production deployment

## Environment Variables

The following environment variables can be configured:

- `NEXT_PUBLIC_API_URL`: Backend API URL
- `NEXT_PUBLIC_STELLAR_NETWORK`: Stellar network (testnet/mainnet)
- `NEXT_PUBLIC_CONTRACT_ID`: Soroban contract ID
- `PORT`: Port to run the server on (default: 3000)

## Production Considerations

1. **Security**: The container runs as a non-root user (nextjs:nodejs)
2. **Optimization**: Uses standalone output for minimal bundle size
3. **Caching**: Docker layer caching optimizes rebuild times
4. **Health Checks**: Consider adding health check endpoints

## Troubleshooting

### Build Fails

- Ensure you have the latest Node.js 18 Alpine image
- Check that package-lock.json is committed
- Verify all dependencies are compatible with Alpine Linux

### Container Won't Start

- Check logs: `docker logs <container-id>`
- Verify environment variables are set correctly
- Ensure port 3000 is not already in use

### Performance Issues

- Increase Docker memory allocation
- Use production-grade hosting for deployment
- Consider using a CDN for static assets
