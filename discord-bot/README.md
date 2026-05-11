# Discord Bot — Guía de setup

## Comandos disponibles

| Comando | Descripción |
|---|---|
| `,nuke` | Elimina el canal y lo recrea con los mismos permisos |
| `,fn @user nombre` / `,forcename @user nombre` | Fuerza un apodo permanente al usuario |
| `,ban @user [razón]` | Banea a un usuario |
| `,unban <ID>` | Desbanea a un usuario por su ID |
| `,mute @user` | Mutea a un usuario (crea el rol "Muted" si no existe) |
| `,unmute @user` | Desmutea a un usuario |
| `,avatar [@user]` | Muestra el avatar del usuario en embed grande |
| `,role add <nombre rol> @user` | Añade un rol existente a un usuario |
| `,kick @user [razón]` | Kickea a un usuario |
| `,join` | El bot entra al canal de voz donde estás |
| `,play <nombre o URL>` | Reproduce una canción de YouTube |
| `,pause` | Pausa la música |
| `,resume` / `,r` | Reanuda la música |

---

## Setup local (para probar)

1. **Instala dependencias:**
   ```bash
   npm install
   ```

2. **Crea el archivo `.env`:**
   ```
   DISCORD_TOKEN=tu_token_aqui
   ```

3. **Corre el bot:**
   ```bash
   npm start
   ```

---

## Deploy en Railway

### 1. Crea el bot en Discord Developer Portal
- Ve a https://discord.com/developers/applications
- Crea una nueva aplicación → Bot → Reset Token → copia el token
- En **Bot**, activa estos **Privileged Gateway Intents**:
  - ✅ SERVER MEMBERS INTENT
  - ✅ MESSAGE CONTENT INTENT

### 2. Invita el bot a tu servidor
Genera el invite link en OAuth2 → URL Generator con estos permisos:
- `bot` scope
- Permisos: `Administrator` (o al menos: Manage Channels, Manage Roles, Ban Members, Kick Members, Manage Nicknames, Send Messages, Embed Links, Connect, Speak)

### 3. Sube el código a GitHub
```bash
git init
git add .
git commit -m "first commit"
git remote add origin https://github.com/tuusuario/tu-repo.git
git push -u origin main
```

### 4. Despliega en Railway
1. Ve a https://railway.app → New Project → Deploy from GitHub repo
2. Selecciona tu repositorio
3. Ve a tu proyecto → **Variables** y agrega:
   ```
   DISCORD_TOKEN = tu_token_de_discord
   ```
4. Railway detectará automáticamente el `package.json` y correrá `npm start`

### Notas importantes
- El comando `,mute` crea automáticamente el rol "Muted" si no existe y lo aplica a todos los canales
- El comando `,fn` (forcename) es persistente: si el usuario cambia su apodo, el bot lo revierte automáticamente
- El bot solo necesita la variable `DISCORD_TOKEN` en Railway, no hay más secrets
