# ---- Build Stage ----
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build -- --configuration=production

# ---- Serve Stage ----
FROM nginx:alpine

# Remplace la config nginx
COPY nginx.conf /etc/nginx/nginx.conf

# Copie le build depuis l'étape précédente
COPY --from=build /app/www /usr/share/nginx/html

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
