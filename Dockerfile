FROM node:22-alpine

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

ARG GEMINI_API_KEY
ENV GEMINI_API_KEY=${GEMINI_API_KEY}
ENV NODE_ENV=production

RUN npm run build

EXPOSE 3019

CMD ["npm", "start"]
