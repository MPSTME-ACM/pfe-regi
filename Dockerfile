# Base image
FROM node:18-alpine

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
