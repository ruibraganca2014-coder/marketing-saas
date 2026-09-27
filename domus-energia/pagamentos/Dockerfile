# Serviço de pagamentos da Domus Energia (Stripe + _plano)
# Construído pelo servidor/docker-compose.yml (serviço "pagamentos", build: ../pagamentos).
FROM node:20-alpine

ENV NODE_ENV=production \
    TZ=Europe/Lisbon \
    DADOS_DIR=/dados \
    PORTA=8080

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src

# Corre como o utilizador "node" (uid 1000), sem privilégios.
# /dados/planos e /dados/pagamentos são montados de servidor/dados/planos e
# servidor/dados/pagamentos: essas pastas têm de pertencer ao uid 1000 no
# servidor (o ./domus.sh trata disso; ou: sudo chown 1000:1000 dados/planos dados/pagamentos).
RUN mkdir -p /dados/planos /dados/pagamentos && chown -R node:node /dados
USER node
EXPOSE 8080

CMD ["node", "src/index.js"]
