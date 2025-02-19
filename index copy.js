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

// Función para limpiar texto
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

// Función para obtener la URL base
const obtenerURLBase = (url) => {
  try {
    const urlObj = new URL(url);
    return `${urlObj.protocol}//${urlObj.hostname}`;
  } catch (e) {
    return "";
  }
};

app.post("/scrape", async (req, res) => {
  try {
    const { url: targetUrl, keyword } = req.body;

    if (!targetUrl) {
      return res.status(400).json({ error: "URL es requerida" });
    }

    const response = await axios.get(targetUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
      },
    });

    const $ = cheerio.load(response.data);
    const baseUrl = obtenerURLBase(targetUrl);
    const noticias = [];

    // Selectores comunes para diferentes sitios web
    $(
      'article, .article, .post, .news-item, .story, .item, [class*="article"], [class*="post"], [class*="news"]',
    ).each((_, element) => {
      const $element = $(element);

      // Obtener título
      const titulo = limpiarTexto(
        $element
          .find('h1, h2, h3, [class*="title"], [class*="headline"]')
          .first()
          .text(),
      );

      // Búsqueda mejorada del enlace
      let enlace;
      // Primero buscar el enlace asociado directamente al título
      const tituloLink = $element
        .find("a")
        .filter(function () {
          return (
            $(this).text().trim() === titulo ||
            $(this).find("h1, h2, h3").text().trim() === titulo
          );
        })
        .first();

      if (tituloLink.length > 0) {
        enlace = tituloLink.attr("href");
      } else {
        // Buscar el enlace principal del artículo
        const mainLink = $element
          .find("a")
          .filter(function () {
            const href = $(this).attr("href");
            return (
              href &&
              href.length > 1 &&
              !href.startsWith("#") &&
              !href.includes("category") &&
              !href.includes("tag") &&
              !href.includes("author") &&
              !href.includes("page")
            );
          })
          .first();
        enlace = mainLink.attr("href");
      }

      // Formatear enlace
      if (enlace) {
        enlace = enlace.split("?")[0]; // Remover parámetros de URL
        if (!enlace.startsWith("http")) {
          enlace = `${baseUrl}${enlace.startsWith("/") ? "" : "/"}${enlace}`;
        }
      }

      // Obtener descripción
      let descripcion = limpiarTexto(
        $element
          .find(
            'p, [class*="description"], [class*="excerpt"], [class*="summary"], [class*="subtitle"]',
          )
          .first()
          .text(),
      );

      // Validar que sea una noticia válida
      if (
        titulo &&
        titulo.length > 10 &&
        !titulo.includes("Menú") &&
        !titulo.includes("Navegación") &&
        !titulo.includes("Search") &&
        !titulo.includes("Newsletter") &&
        enlace &&
        enlace.length > baseUrl.length + 1
      ) {
        // Verificar palabra clave si existe
        if (
          !keyword ||
          titulo.toLowerCase().includes(keyword.toLowerCase()) ||
          descripcion.toLowerCase().includes(keyword.toLowerCase())
        ) {
          // Limpiar URL final
          const urlLimpia = enlace.replace(/\/$/, ""); // Remover slash final si existe

          noticias.push({
            titulo,
            descripcion: descripcion || "No hay descripción disponible",
            enlace: urlLimpia,
          });
        }
      }
    });

    // Eliminar duplicados y filtrar resultados inválidos
    const noticiasUnicas = Array.from(new Set(noticias.map((n) => n.titulo)))
      .map((titulo) => noticias.find((n) => n.titulo === titulo))
      .filter(
        (noticia) =>
          noticia.titulo && noticia.enlace && noticia.enlace.includes(baseUrl),
      );

    const resultado = {
      sitio: baseUrl,
      total_noticias: noticiasUnicas.length,
      noticias: noticiasUnicas,
    };

    res.json(resultado);
  } catch (error) {
    res.status(500).json({
      error: "Error al obtener los datos",
      detalle: error.message,
      url: req.body.url,
    });
  }
});

app.listen(port, () => {
  console.log(`Servidor corriendo en http://localhost:${port}`);
});
