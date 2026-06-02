FROM node:18-bullseye

# install ffmpeg
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production
COPY . .

ENV NODE_ENV=production
CMD ["node", "sender.js"]
