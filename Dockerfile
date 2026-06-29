FROM node:20-alpine AS production

WORKDIR /app

# Copy built artifacts from local build
COPY dist ./dist
COPY package.json ./

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/ > /dev/null || exit 1

# Start production server
CMD ["node", "dist/boot.js"]
