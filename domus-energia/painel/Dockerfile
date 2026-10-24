# Painel da empresa Domus Energia (docs/PAINEL-EMPRESA.md)
# Construído pelo servidor/docker-compose.yml (serviço "painel", build: ../painel).
# Node 22: base de dados com o módulo nativo do Node "node:sqlite" (sem
# dependências compiladas). Única dependência npm: mqtt (só leitura dos alertas).
FROM node:22-alpine

ENV NODE_ENV=production \
    TZ=Europe/Lisbon \
    DADOS_DIR=/dados \
    PORTA=8080

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public
# O manual de instalações BT (só com sessão, src/manual.js): fora de public/, nunca servido como ficheiro estático.
COPY recursos ./recursos

# Corre como o utilizador "node" (uid 1000), sem privilégios. As pastas de
# /dados são montadas do servidor (ver docker-compose.yml): painel e
# pedidos-admin com escrita; planos, pagamentos e clientes só de leitura.
RUN mkdir -p /dados/painel /dados/pedidos-admin && chown -R node:node /dados
USER node
EXPOSE 8080

# --disable-warning: o node:sqlite ainda escreve um aviso "experimental" no
# arranque (Node 22.13+ já não precisa de --experimental-sqlite).
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.js"]
