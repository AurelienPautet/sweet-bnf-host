# Utilisation d'une image Node.js officielle légère
FROM node:20-slim

# Définition des variables d'environnement
ENV NODE_ENV=production \
    PORT=3000

# Répertoire de travail
WORKDIR /app

# Copie des fichiers de configuration et dépendances
COPY package*.json ./
COPY tsconfig.json ./

# Installation des dépendances (y compris devDependencies pour la compilation)
RUN npm ci --include=dev

# Copie des fichiers sources et publics
COPY src/ ./src/
COPY public/ ./public/

# Compilation du code TypeScript
RUN npm run build

# Suppression des devDependencies pour alléger l'image finale
RUN npm prune --production

# Exposition du port
EXPOSE 3000

# Commande pour démarrer le serveur standalone HTTP/SSE
CMD ["npm", "run", "start:http"]
