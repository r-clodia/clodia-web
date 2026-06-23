FROM node:18
WORKDIR /app
COPY . .
RUN npm ci
# Auth gate ATTIVO (F2a): nessun bypass. Senza una sessione valida la webui
# mostra solo il modulo di login. Per un build di sviluppo senza login si può
# ancora passare PUBLIC_AUTH_DISABLED=1 a build-time.
RUN npm run build
EXPOSE 7843
CMD ["npm","run","preview","--","--port","7843","--host","0.0.0.0"]
