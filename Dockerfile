# --- build ---
FROM node:20-alpine AS build
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npx prisma generate
RUN npm run build
# seed 腳本獨立編譯成 CommonJS，執行期用 node 直接跑，避免容器裡用 ts-node 碰到的 ESM 判斷問題
RUN npx tsc prisma/seed.ts --outDir dist-seed --module commonjs --target ES2021 \
    --esModuleInterop --skipLibCheck --resolveJsonModule

# --- runtime ---
FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-seed ./dist-seed
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]
