Aquí tienes el `README.md` definitivo, redactado estrictamente basándome en el **código real que hemos desarrollado** (Vanilla JS, Chart.js, Cifrado AES-GCM, API de Bonos BYMA, etc.), eliminando la referencia a React/Tailwind que estaba obsoleta.

Copia y pega este contenido en tu archivo `README.md`:

---

# 🧠 Amygdalé — Financial Dashboard & Risk Control

> *"Las finanzas están ligadas al control de impulsos y la supervivencia económica; Amygdalé es el centro de ese control."*

**Amygdalé** es un dashboard financiero personal de alto rendimiento, diseñado bajo la filosofía **Local-First** y **Security-First**. No requiere registro, no guarda datos en servidores remotos y opera completamente en el navegador del usuario. Funciona como un "Second Brain" financiero, centralizando el seguimiento de activos (Bonos Argentinos, Acciones Globales y Cripto) para facilitar la toma de decisiones lógicas.

🔗 **Live Demo:** [https://amygdale.netlify.app](https://amygdale.netlify.app)

---

## ✨ Funcionalidades Actuales

### 📊 Visualización y Métricas
*   **Dashboard en Tiempo Real:** Precios actualizados vía Yahoo Finance, CoinGecko y BYMA.
*   **Conversión Automática:** Integración con `DolarApi` para conversión a USD usando la tasa MEP en tiempo real.
*   **Gráficos Interactivos:**
    *   *Distribución (Donut):* Porcentaje de participación de cada activo.
    *   *Histórico (Línea):* Evolución del portfolio vs. Benchmark con filtros (1M, 6M, YTD, 1Y).
*   **Cálculos Financieros:** Ganancia/Pérdida (P&L), Variación Ponderada del día, Precio Promedio de Compra (PPC) y Tenencia automática.

### 🔐 Seguridad y Privacia (Local-First)
*   **Cifrado AES-GCM:** Implementación de Web Crypto API para cifrar el portfolio en el navegador con una contraseña del usuario.
*   **Persistencia Local:** Todos los datos se guardan en `localStorage`. Nada sale de tu dispositivo.
*   **Backup Manual:** Sistema completo de **Exportar/Importar JSON** para respaldo de posiciones e histórico.

### 🎨 Diseño y UX
*   **Estética Cyberpunk/Terminal:** Interfaz oscura, tipografías monoespaciadas para datos numéricos y alto contraste.
*   **Responsivo:** Diseño adaptativo para escritorio y móviles.
*   **Badges Dinámicos:** Identificación visual automática de `BONO AR`, `ACCIÓN`, `GLOBAL` y `CRYPTO`.
*   **Relojes de Mercado:** Hora actual en Buenos Aires y Nueva York.

---

## 🛠️ Stack Tecnológico

| Capa | Tecnología |
| :--- | :--- |
| **Core** | Vanilla JavaScript (ES6+), HTML5, CSS3 |
| **Gráficos** | Chart.js (CDN) |
| **Seguridad** | Web Crypto API (AES-GCM / PBKDF2) |
| **Hosting** | Netlify (con Serverless Functions para Proxy CORS) |
| **APIs** | Yahoo Finance v8, CoinGecko, BYMA Open Data, DolarApi |

---

##  Estructura del Proyecto

```text
.
├── index.html          # Estructura semántica del dashboard
├── style.css           # Estilos con variables CSS y modo oscuro
├── script.js           # Lógica principal (API, Gráficos, Cifrado, Estado)
├── netlify.toml        # Configuración de despliegue y Proxy CORS
└── README.md           # Documentación del proyecto
```

---

## 🚀 Cómo Ejecutar

### Opción A: Local (Desarrollo)
1. Clona el repositorio:
   ```bash
   git clone https://github.com/Neymors/Amygdale.git
   ```
2. Abre el proyecto en tu editor de código.
3. Debido a las restricciones CORS de las APIs financieras, se recomienda usar un servidor local (como Live Server en VS Code) o desplegarlo directamente.

### Opción B: Despliegue (Netlify)
El proyecto está configurado para desplegarse automáticamente.
1. El archivo `netlify.toml` incluye la configuración del Proxy (`/api/proxy`) para evitar bloqueos de CORS en las APIs externas.
2. Solo necesitas conectar tu repositorio a Netlify y hacer deploy.

---

## 🔐 Nota sobre la Seguridad

El sistema de cifrado (AES-GCM) utiliza la clave derivada de tu contraseña localmente. **Si olvidas tu contraseña, no es posible recuperar los datos**, ya que Amygdalé no almacena ninguna copia de seguridad en la nube. Esta es una decisión de diseño para garantizar la máxima privacidad.

---

## 🗺️ Roadmap Futuro
*   [ ] Integración con **Ippókampos** (Orquestador modular).
*   [ ] Alertas de precio personalizadas.
*   [ ] Soporte para múltiples carteras (cuentas separadas).
*   [ ] Análisis técnico básico en los gráficos de líneas.

---

*"El control no es restricción, es libertad."* — **Hecho con ❤️ en Argentina.**
