require("dotenv").config();
const https = require("https");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const express = require("express");
const axios = require("axios");
const cheerio = require("cheerio");
const cors = require("cors");
const path = require("path");

// Verificar que tenemos la API key al inicio
if (!process.env.CLAUDE_API_KEY) {
  console.error("ERROR: No se encontró la API key de Claude en las variables de entorno");
  process.exit(1);
}

console.log("API key de Claude cargada correctamente (primeros 10 caracteres):", process.env.CLAUDE_API_KEY.substring(0, 10) + "...");

const app = express();
const port = process.env.PORT || 3000;

// Configuración de CORS
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Accept'],
  credentials: true
}));

// Configuración de body parser
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Servir archivos estáticos
app.use(express.static(path.join(__dirname, "public")));

// Ruta principal que sirve index.html
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const limpiarTexto = (texto) => {
  if (!texto) return "";
  return texto
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\n/g, "")
    .replace(/\t/g, "")
    .replace(/Exclusivo suscriptor/g, "")
    .replace(/\s{2,}/g, " ");
};

const obtenerURLBase = (url) => {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.hostname}`;
  } catch (e) {
    return "";
  }
};

const commonConfig = {
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.8,en-US;q=0.5,en;q=0.3",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    DNT: "1",
  },
  timeout: 15000,
  maxRedirects: 5,
};

app.post("/scrape", async (req, res) => {
  try {
    const { url: targetUrl, keyword } = req.body;

    if (!targetUrl) {
      return res.status(400).json({ error: "URL es requerida" });
    }

    const response = await axios.get(targetUrl, commonConfig);
    const $ = cheerio.load(response.data);
    const baseUrl = obtenerURLBase(targetUrl);
    const noticias = [];

    // Detectar el sitio web
    const isPuroMarketing = targetUrl.includes("puromarketing.com");
    const isEmol = targetUrl.includes("emol.com");

    if (isPuroMarketing) {
      // Scraping específico para puromarketing
      $(".item-news").each((_, element) => {
        const $element = $(element);

        const titulo = limpiarTexto(
          $element.find(".item-title").first().text(),
        );
        let enlace = $element.find(".item-title a").first().attr("href");
        const descripcion = limpiarTexto(
          $element.find(".item-description").first().text(),
        );

        if (enlace) {
          try {
            enlace = enlace.split("#")[0].split("?")[0];
            if (!enlace.startsWith("http")) {
              enlace = new URL(enlace, baseUrl).href;
            }
          } catch (e) {
            console.error("Error al procesar URL:", e);
            return;
          }
        }

        if (
          titulo &&
          titulo.length > 10 &&
          !titulo.match(/menu|navegacion|search|newsletter/i) &&
          enlace
        ) {
          if (
            !keyword ||
            titulo.toLowerCase().includes(keyword.toLowerCase()) ||
            descripcion.toLowerCase().includes(keyword.toLowerCase())
          ) {
            noticias.push({
              titulo,
              descripcion: descripcion || "No hay descripción disponible",
              enlace,
            });
          }
        }
      });
    } else if (isEmol) {
      // Scraping específico para emol.com
      $(
        ".col_center_noticia1-390px, .col_center_noticia2-390px, .caja_multi_model_item",
      ).each((_, element) => {
        const $element = $(element);

        const titulo = limpiarTexto(
          $element.find("h1 a, h3 a, .caja_multi_model_txt a").first().text(),
        );
        let enlace = $element
          .find("h1 a, h3 a, .caja_multi_model_txt a")
          .first()
          .attr("href");

        let descripcion = limpiarTexto(
          $element
            .find("p")
            .text()
            .replace(/^\d{2}:\d{2}\s*\|\s*/, ""),
        );

        if (enlace) {
          try {
            enlace = enlace.split("#")[0].split("?")[0];
            if (!enlace.startsWith("http")) {
              enlace = new URL(enlace, baseUrl).href;
            }
          } catch (e) {
            console.error("Error al procesar URL:", e);
            return;
          }
        }

        if (
          titulo &&
          titulo.length > 10 &&
          !titulo.match(/menu|navegacion|search|newsletter/i) &&
          enlace
        ) {
          if (
            !keyword ||
            titulo.toLowerCase().includes(keyword.toLowerCase()) ||
            descripcion.toLowerCase().includes(keyword.toLowerCase())
          ) {
            noticias.push({
              titulo,
              descripcion: descripcion || "No hay descripción disponible",
              enlace,
            });
          }
        }
      });
    } else {
      // Scraping genérico para otros sitios
      const selectores = [
        "article",
        ".article",
        ".post",
        ".entry",
        ".news-item",
        ".blog-post",
        '[class*="article"]',
        '[class*="post"]',
        '[class*="entry"]',
      ].join(", ");

      $(selectores).each((_, element) => {
        const $element = $(element);

        const titulo = limpiarTexto(
          $element
            .find('h1, h2, h3, .title, .headline, [class*="title"]')
            .first()
            .text(),
        );

        let enlace;
        const tituloLink = $element
          .find("a")
          .filter(function () {
            return (
              $(this).text().trim() === titulo ||
              $(this).find("h1, h2, h3").text().trim() === titulo
            );
          })
          .first();

        if (tituloLink.length) {
          enlace = tituloLink.attr("href");
        } else {
          enlace = $element
            .find("a")
            .not('[href*="category"], [href*="tag"], [href*="author"]')
            .first()
            .attr("href");
        }

        if (enlace) {
          try {
            enlace = enlace.split("#")[0].split("?")[0];
            if (!enlace.startsWith("http")) {
              enlace = new URL(enlace, baseUrl).href;
            }
          } catch (e) {
            console.error("Error al procesar URL:", e);
            return;
          }
        }

        const descripcion = limpiarTexto(
          $element
            .find(
              'p, [class*="excerpt"], [class*="description"], [class*="summary"]',
            )
            .first()
            .text(),
        );

        if (
          titulo &&
          titulo.length > 10 &&
          !titulo.match(/menu|navegacion|search|newsletter/i) &&
          enlace
        ) {
          if (
            !keyword ||
            titulo.toLowerCase().includes(keyword.toLowerCase()) ||
            descripcion.toLowerCase().includes(keyword.toLowerCase())
          ) {
            noticias.push({
              titulo,
              descripcion: descripcion || "No hay descripción disponible",
              enlace,
            });
          }
        }
      });
    }

    const noticiasUnicas = Array.from(new Set(noticias.map((n) => n.titulo)))
      .map((titulo) => noticias.find((n) => n.titulo === titulo))
      .filter((noticia) => noticia && noticia.enlace);

    res.json({
      sitio: baseUrl,
      total_noticias: noticiasUnicas.length,
      noticias: noticiasUnicas,
    });
  } catch (error) {
    console.error("Error en scrape:", error);
    res.status(500).json({
      error: "Error al obtener los datos",
      detalle: error.message,
    });
  }
});

app.post("/scrape-single", async (req, res) => {
  try {
    let { url } = req.body;

    if (!url) {
      return res.status(400).json({
        error: "URL es requerida",
        success: false,
      });
    }

    const isEmol = url.includes("emol.com");

    async function intentarScraping(urlToTry) {
      const config = {
        ...commonConfig,
        validateStatus: function (status) {
          return status >= 200 && status < 500;
        },
      };

      const response = await axios.get(urlToTry, config);
      if (response.status === 404) {
        throw new Error("Página no encontrada");
      }
      return response;
    }

    let response;
    try {
      response = await intentarScraping(url);
    } catch (error) {
      const alternativeUrl = url.endsWith("/") ? url.slice(0, -1) : url + "/";
      try {
        response = await intentarScraping(alternativeUrl);
        url = alternativeUrl;
      } catch (secondError) {
        throw new Error("No se pudo acceder a la página en ningún formato");
      }
    }

    const $ = cheerio.load(response.data);

    if (isEmol) {
      // Manejo específico para Emol
      const titulo = limpiarTexto(
        $("#cuDetalle_cuTitular_tituloNoticia").text(),
      );
      const bajada = limpiarTexto(
        $("#cuDetalle_cuTitular_bajadaNoticia").text(),
      );

      // Obtener fecha y autor
      let fecha = "";
      let autor = "";
      const infoNoticia = $(".info-notaemol-porfecha").text();
      if (infoNoticia) {
        const partes = infoNoticia.split("|").map((p) => p.trim());
        fecha = partes[0] || "";
        autor = partes[1] || "";
      }

      // Obtener el contenido del artículo
      let contenido = "";
      $("#cuDetalle_cuTexto_textoNoticia")
        .find("div, p")
        .each((_, element) => {
          const texto = $(element).text().trim();
          if (
            texto &&
            texto.length > 10 &&
            !texto.match(/copyright|términos|condiciones/i)
          ) {
            contenido += texto + "\n\n";
          }
        });

      // Obtener imágenes
      const imagenes = new Set();
      $(
        "#cuDetalle_cuTexto_ucImagen_contGaleria img, #cuDetalle_cuTexto_ucImagen_Img",
      ).each((_, element) => {
        const src = $(element).attr("src");
        if (src && !src.match(/avatar|icon|logo|banner|advertisement/i)) {
          try {
            const imageUrl = new URL(src, url).href;
            imagenes.add(imageUrl);
          } catch (e) {
            console.error("Error al procesar URL de imagen:", e);
          }
        }
      });

      const detalleNoticia = {
        success: true,
        titulo: titulo || "Sin título",
        bajada: bajada || "",
        fecha: fecha || "Fecha no disponible",
        autor: autor || "Autor no especificado",
        contenido: contenido.trim() || "No se pudo extraer el contenido",
        imagenes: Array.from(imagenes).slice(0, 5),
        url: url,
      };

      res.json(detalleNoticia);
    } else {
      // Manejo para otros sitios
      const selectores = {
        titulo: [
          "h1.entry-title",
          "h1.post-title",
          "article h1",
          ".article-title",
          ".post-title",
          "h1",
          "header h1",
        ],
        contenido: [
          "article .entry-content",
          ".post-content",
          ".article-content",
          ".entry-content",
          "article p",
          ".content p",
          ".post-body p",
          '[itemprop="articleBody"] p',
        ],
        fecha: [
          "time.entry-date",
          ".post-date",
          ".entry-date",
          "time[datetime]",
          ".date",
          '[itemprop="datePublished"]',
        ],
        autor: [
          ".author-name",
          ".entry-author",
          ".post-author",
          '[rel="author"]',
          ".author",
          '[itemprop="author"]',
        ],
        imagen: [
          "article img",
          ".entry-content img",
          ".post-content img",
          ".article-content img",
          '[itemprop="image"]',
        ],
      };

      const encontrarContenido = (selectoresArr) => {
        for (let selector of selectoresArr) {
          const elemento = $(selector);
          if (elemento.length) {
            return elemento;
          }
        }
        return null;
      };

      const titulo = limpiarTexto(
        encontrarContenido(selectores.titulo)?.text(),
      );
      const fecha = limpiarTexto(encontrarContenido(selectores.fecha)?.text());
      const autor = limpiarTexto(encontrarContenido(selectores.autor)?.text());

      let contenido = "";
      const contenidoElemento = encontrarContenido(selectores.contenido);
      if (contenidoElemento) {
        contenidoElemento.find("p").each((_, element) => {
          const texto = $(element).text().trim();
          if (
            texto &&
            texto.length > 10 &&
            !texto.match(/copyright|términos|condiciones/i)
          ) {
            contenido += texto + "\n\n";
          }
        });
      }

      const imagenes = new Set();
      selectores.imagen.forEach((selector) => {
        $(selector).each((_, element) => {
          const src =
            $(element).attr("src") ||
            $(element).attr("data-src") ||
            $(element).attr("data-lazy-src");

          if (src && !src.match(/avatar|icon|logo|banner|advertisement/i)) {
            try {
              const imageUrl = new URL(src, url).href;
              imagenes.add(imageUrl);
            } catch (e) {
              console.error("Error al procesar URL de imagen:", e);
            }
          }
        });
      });

      if (!contenido) {
        $("p").each((_, element) => {
          const texto = $(element).text().trim();
          if (
            texto &&
            texto.length > 10 &&
            !texto.match(/copyright|términos|condiciones/i)
          ) {
            contenido += texto + "\n\n";
          }
        });
      }

      const detalleNoticia = {
        success: true,
        titulo: titulo || "Sin título",
        fecha: fecha || "Fecha no disponible",
        autor: autor || "Autor no especificado",
        contenido: contenido.trim() || "No se pudo extraer el contenido",
        imagenes: Array.from(imagenes).slice(0, 5),
        url: url,
      };

      res.json(detalleNoticia);
    }
  } catch (error) {
    console.error("Error en scrape-single:", error);
    let mensajeError = "Error al obtener los datos de la noticia";

    if (error.response) {
      mensajeError = `Error ${error.response.status}: ${error.response.statusText}`;
    } else if (error.request) {
      mensajeError = "No se pudo conectar con el servidor";
    }

    res.status(error.response?.status || 500).json({
      error: mensajeError,
      detalle: error.message,
      success: false,
    });
  }
});

app.post("/rewrite-with-ai", async (req, res) => {
  console.log("Recibida solicitud de reescritura");
  const titulo = req.body.titulo; // Guardar título al inicio para el manejo de errores
  
  try {
    const { titulo, contenido } = req.body;
    console.log("Datos recibidos:", { 
      titulo, 
      contenidoLength: contenido ? contenido.length : 0 
    });

    if (!titulo || !contenido) {
      console.log("Faltan datos requeridos");
      return res.status(400).json({
        error: "Se requieren tanto el título como el contenido",
      });
    }

    const prompt = `Actúa como un periodista experto y reescribe completamente esta noticia, creando una versión nueva y de unos 5 o 6 párrafos no tan extensos pero que mantenga los hechos principales pero con un enfoque fresco y diferente pero usando párrafos bien separados con doble salto de línea (\\n\\n)

    INSTRUCCIONES DETALLADAS:
    
    1. ESTRUCTURA:
       - Crea un nuevo título impactante y original
       - Comienza con un párrafo introductorio fuerte que enganche al lector
       - Expande el contenido significativamente (al menos 3 veces más largo)
       - Incluye subtítulos para organizar la información
       - Cierra con una conclusión fuerte
    
    2. CONTENIDO:
       - Agrega contexto histórico relevante
       - Incluye datos estadísticos relacionados
       - Menciona casos similares o precedentes
       - Explora el impacto en diferentes sectores
       - Añade perspectivas de expertos (reales o hipotéticos)
       - Humaniza la historia con ejemplos y anécdotas
    
    3. ESTILO:
       - Usa un tono profesional pero accesible
       - Emplea un lenguaje rico y variado
       - Incluye citas y testimonios
       - Mantén un ritmo narrativo fluido
       - Usa transiciones suaves entre párrafos
       - Asegúrate de que sea fácil de leer

NOTICIA ORIGINAL:
Título: ${titulo}

Contenido:
${contenido}

FORMATO DE RESPUESTA:
{
    "titulo": "Un título nuevo y atractivo",
    "contenido": "Primer párrafo...\n\nSegundo párrafo...\n\nTercer párrafo..."
}`;

    console.log("Preparando solicitud a Claude API");
    
    // Verificar que tenemos la API key
    if (!process.env.CLAUDE_API_KEY) {
      console.error("API key no encontrada");
      throw new Error("No se ha configurado la API key de Claude");
    }
    console.log("API key encontrada:", process.env.CLAUDE_API_KEY.substring(0, 10) + "...");

    // Configuración de la solicitud
    const requestOptions = {
      method: "POST",
      headers: {
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-sonnet-20240229",
        max_tokens: 4000,
        temperature: 0.7,
        messages: [
          {
            role: "user",
            content: prompt
          }
        ]
      })
    };

    console.log("Enviando solicitud a Claude API");
    
    // Función para hacer la solicitud con reintentos
    const makeRequest = async (retryCount = 0, maxRetries = 3) => {
      try {
        const response = await fetch("https://api.anthropic.com/v1/messages", requestOptions);
        console.log("Respuesta recibida de Claude. Status:", response.status);

        if (response.status === 529 && retryCount < maxRetries) {
          console.log(`API sobrecargada, reintentando en 2 segundos... (intento ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return makeRequest(retryCount + 1, maxRetries);
        }

        if (!response.ok) {
          const errorText = await response.text();
          console.error("Error detallado de Claude:", {
            status: response.status,
            statusText: response.statusText,
            error: errorText,
          });
          throw new Error(`Error en la API de Claude: ${response.status} ${response.statusText}`);
        }

        return response;
      } catch (error) {
        if (retryCount < maxRetries) {
          console.log(`Error en la solicitud, reintentando en 2 segundos... (intento ${retryCount + 1}/${maxRetries})`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          return makeRequest(retryCount + 1, maxRetries);
        }
        throw error;
      }
    };

    // Hacer la solicitud con reintentos
    const response = await makeRequest();
    console.log("Respuesta completa de Claude:", JSON.stringify(response, null, 2));
      
    if (!response.ok) {
      throw new Error(`Error en la API de Claude: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Respuesta completa de Claude:", JSON.stringify(data, null, 2));
      
    if (!data.content || !data.content[0] || !data.content[0].text) {
      console.error("Estructura de respuesta inválida:", data);
      throw new Error("Formato de respuesta inválido de la API");
    }

    let respuestaIA = data.content[0].text;
    console.log("Procesando respuesta de Claude");
      
    try {
      // Limpiar la respuesta
      respuestaIA = respuestaIA
        .replace(/```json\s*|\s*```/g, "")
        .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
        .trim();

      console.log("Respuesta limpia:", respuestaIA);

      // Intentar extraer el JSON si está dentro de un objeto más grande
      const jsonMatch = respuestaIA.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        respuestaIA = jsonMatch[0];
      }

      const resultado = JSON.parse(respuestaIA);
        
      if (!resultado.titulo || !resultado.contenido) {
        throw new Error("La respuesta no contiene los campos requeridos");
      }

      // Limpiar y formatear el contenido
      resultado.titulo = resultado.titulo.trim();
        
      // Preservar los saltos de línea originales y solo limpiar espacios extra
      resultado.contenido = resultado.contenido
        .split(/\n+/) // Dividir por uno o más saltos de línea
        .map(parrafo => parrafo.trim()) // Limpiar espacios al inicio y final
        .filter(parrafo => parrafo.length > 0) // Eliminar líneas vacías
        .join("\n\n"); // Unir con doble salto de línea para separar párrafos
        
      console.log("Resultado procesado:", {
        titulo: resultado.titulo,
        contenidoLength: resultado.contenido.length
      });

      return res.json(resultado);
    } catch (parseError) {
      console.error("Error al parsear la respuesta:", parseError);
      console.error("Contenido que causó el error:", respuestaIA);
      throw new Error("No se pudo procesar la respuesta de la IA");
    }
  } catch (error) {
    console.error("Error en rewrite-with-ai:", error);
    return res.status(500).json({
      error: error.message,
      errorType: "AI_REWRITE_ERROR",
      originalTitle: titulo || "Título no disponible"
    });
  }
});

// Middleware para manejar errores
app.use((err, req, res, next) => {
  console.error('Error en el servidor:', err);
  res.status(500).json({
    error: 'Error interno del servidor',
    message: err.message
  });
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
