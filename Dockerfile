FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build
RUN npm prune --omit=dev
RUN cp -r src/prompts/. dist/prompts/

EXPOSE 3100

CMD ["node", "dist/index.js"]
