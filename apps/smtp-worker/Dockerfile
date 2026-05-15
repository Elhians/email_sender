FROM node:24-alpine AS base
WORKDIR /app
COPY package.json tsconfig.base.json ./
COPY apps/smtp-worker/package.json apps/smtp-worker/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm install
COPY . .
RUN npm run build --workspace @email-sender/smtp-worker

FROM node:24-alpine
WORKDIR /app
COPY --from=base /app/apps/smtp-worker/dist ./dist
COPY --from=base /app/node_modules ./node_modules
ENV NODE_ENV=production
CMD ["node", "dist/index.js"]
