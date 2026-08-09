# Base image
# node 18 went EOL in April 2025 (no security patches) and was two majors behind
# the version this is developed against. Next 16 will also require >= 20.
FROM node:22-alpine

WORKDIR /app

# Need this for Sync Job
RUN apk add --no-cache curl

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
