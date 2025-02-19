const express = require("express");
const cheerio = require("cheerio");
const axios = require("axios");
const cors = require("cors");

const app = express();
const port = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());
app.use(express.static("public"));

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

// Configuración común para las solicitudes
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
      // Primer intento con la URL original
      response = await intentarScraping(url);
    } catch (error) {
      // Si falla, intentar con el formato alternativo
      const alternativeUrl = url.endsWith("/") ? url.slice(0, -1) : url + "/";
      try {
        response = await intentarScraping(alternativeUrl);
        url = alternativeUrl; // Actualizar la URL si el segundo intento tiene éxito
      } catch (secondError) {
        throw new Error("No se pudo acceder a la página en ningún formato");
      }
    }

    const $ = cheerio.load(response.data);

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

    const titulo = limpiarTexto(encontrarContenido(selectores.titulo)?.text());
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
      url: url, // Incluir la URL final utilizada
    };

    res.json(detalleNoticia);
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

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
