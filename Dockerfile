FROM node:20-alpine
WORKDIR /app
COPY package.json ./
COPY *.js ./
EXPOSE 4141
CMD ["node", "index.js"]
