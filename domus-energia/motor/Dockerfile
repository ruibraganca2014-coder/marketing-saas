# Motor de regras da Domus Energia
# Construído pelo servidor/docker-compose.yml (serviço "motor", build: ../motor).
FROM node:20-alpine

ENV NODE_ENV=production \
    TZ=Europe/Lisbon \
    DADOS_DIR=/dados

# tzdata: horas de Lisboa corretas nos registos (as automações usam o Intl do Node).
RUN apk add --no-cache tzdata

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Corre como o utilizador "node" (uid 1000), sem privilégios.
# /dados é montado de servidor/dados/motor: essa pasta tem de pertencer ao
# uid 1000 no servidor (sudo chown -R 1000:1000 servidor/dados/motor).
RUN mkdir -p /dados && chown node:node /dados
USER node
VOLUME ["/dados"]

CMD ["node", "src/index.js"]
