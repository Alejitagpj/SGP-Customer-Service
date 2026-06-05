# 🚀 Guía de Despliegue SGP - Vercel/Netlify

## Opción 1: Desplegar en Vercel (RECOMENDADO)

Vercel es la plataforma oficial para proyectos Vite y React.

### Paso 1: Preparar el repositorio Git

```bash
cd /path/to/SGP
git init
git add .
git commit -m "Initial commit: SGP MVP with Supabase integration"
git branch -M main
```

Luego sube a GitHub:
```bash
git remote add origin https://github.com/TU_USUARIO/sgp.git
git push -u origin main
```

### Paso 2: Crear cuenta en Vercel

1. Visita https://vercel.com
2. Haz clic en "Sign Up" y usa tu cuenta de GitHub
3. Autoriza a Vercel acceder a tu cuenta

### Paso 3: Importar proyecto

1. En el dashboard de Vercel, haz clic en "New Project"
2. Selecciona "Import Git Repository"
3. Busca `sgp` y selecciona el repositorio
4. Haz clic en "Import"

### Paso 4: Configurar variables de entorno

En el formulario de configuración, agrega las variables de entorno:

```
VITE_SUPABASE_URL=https://gywwdyqvvhzwlitewtts.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_USE_MOCK=false
```

**IMPORTANTE:** No uses `false` como string. En Vercel, Vite lo interpretará correctamente.

### Paso 5: Configurar build

Las opciones por defecto deberían funcionar:
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Node Version:** 18.x (recomendado)

### Paso 6: Deploy

Haz clic en "Deploy". Vercel compilará y desplegará automáticamente.

**La URL será:** `https://sgp-[random-id].vercel.app`

---

## Opción 2: Desplegar en Netlify

### Paso 1: Conectar repositorio

1. Visita https://netlify.com
2. Haz clic en "New site from Git"
3. Conecta GitHub y selecciona el repositorio `sgp`

### Paso 2: Configurar build

- **Build command:** `npm run build`
- **Publish directory:** `dist`

### Paso 3: Agregar variables de entorno

En "Site settings" → "Build & deploy" → "Environment", agrega:

```
VITE_SUPABASE_URL=https://gywwdyqvvhzwlitewtts.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
VITE_USE_MOCK=false
```

### Paso 4: Deploy

Netlify detectará cambios en `main` y desplegará automáticamente.

---

## 🔧 Actualizar URLs de QR después del deploy

Una vez que tengas la URL pública (ej: `https://sgp-prod.vercel.app`), necesitas:

### 1. Actualizar `vite.config.ts` para producción

```typescript
export default defineConfig({
  // ... existing config
  define: {
    'import.meta.env.VITE_APP_URL': JSON.stringify(
      import.meta.env.PROD ? 'https://sgp-prod.vercel.app' : 'http://127.0.0.1:5173'
    )
  }
})
```

### 2. Actualizar generador de QR

En AdminDashboard, la URL se genera automáticamente:

```typescript
const baseUrl = window.location.origin; // Será la URL de Vercel en producción
const { data, error } = await sgpApi.generateQRCodes(selectedStore.id, baseUrl);
```

### 3. Regenerar QR codes

Una vez en producción:
1. Accede al dashboard admin
2. Selecciona una sucursal
3. Haz clic en "Generar QR"
4. Los códigos tendrán la URL pública

---

## 📱 Configurar acceso desde móviles

### En Vercel/Netlify (Producción)

¡Ya funciona automáticamente! Los códigos QR apuntarán a tu URL pública.

### En localhost (Desarrollo)

Para probar desde móviles en la misma red:

1. Obtén tu IP local:
   ```powershell
   ipconfig | findstr "IPv4"
   # Busca la que comienza con 192.168.x.x o 10.0.x.x
   ```

2. Inicia Vite escuchando en todas las interfaces:
   ```bash
   npm run dev -- --host 0.0.0.0
   ```

3. En móvil, accede a: `http://192.168.x.y:5173`

---

## 🔐 Seguridad antes de producción

### 1. Revisar RLS (Row Level Security) en Supabase

Ve a https://supabase.com/dashboard/project/gywwdyqvvhzwlitewtts/auth/policies

Asegúrate que:
- **Clientes** solo puedan leer `categories`, `products`
- **Clientes** puedan crear `orders` para su sesión
- **Staff** puedan leer y actualizar `orders`
- **Admin** tengan acceso total

### 2. Cambiar PIN códigos por defecto

En Supabase SQL Editor, ejecuta:

```sql
UPDATE stores SET pin_code = 'TU_NUEVO_PIN' WHERE id = 'store-1-uuid';
```

### 3. Verificar credenciales en producción

Asegúrate que `VITE_USE_MOCK=false` en Vercel/Netlify.

---

## 🚀 CI/CD Automático

Tanto Vercel como Netlify detectan cambios en `main` y despliegan automáticamente.

Para hacer push después de cambios:

```bash
git add .
git commit -m "Descripción de cambios"
git push origin main
```

El sitio se actualiza en ~60-90 segundos.

---

## 📊 Monitorear deployments

### Vercel
- Dashboard: https://vercel.com/dashboard
- Logs en tiempo real disponibles

### Netlify
- Dashboard: https://app.netlify.com
- Build logs en "Deploy settings"

---

## ⚡ Optimizaciones para producción

### 1. Habilitar compresión

Vercel/Netlify lo hacen automáticamente.

### 2. Cachingde assets

Ambas plataformas cachean automáticamente `dist/` con headers HTTP.

### 3. Deshabilitar mapas fuente

En `vite.config.ts`:

```typescript
build: {
  sourcemap: false, // Reduce tamaño
  minify: 'terser'  // Minimiación agresiva
}
```

---

## 🎯 Próximos pasos

1. ✅ Desplegar en Vercel/Netlify
2. ✅ Generar QR codes con URL pública
3. ✅ Probar desde móviles en la red pública
4. ✅ Imprimir QR codes para las 15 mesas
5. ✅ Entrenar staff en los 3 dashboards (admin, cocina, mesero)
6. ✅ Ejecutar scripts de agregación diaria (`daily_aggregate.cjs`)
7. ✅ Configurar reportes mensuales (`monthly_report.cjs`)

---

## 🆘 Troubleshooting

### "Module not found" en build

```bash
npm install
npm run build
```

### QR codes no funcionan

- Verifica que la URL base sea correcta en AdminDashboard
- Prueba accediendo directamente a la URL del QR en navegador

### Supabase connection errors

- Verifica VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en Vercel/Netlify
- Prueba la conexión desde browser console: `console.log(import.meta.env.VITE_SUPABASE_URL)`

