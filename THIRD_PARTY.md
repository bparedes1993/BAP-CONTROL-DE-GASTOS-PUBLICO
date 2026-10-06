# Dependencias de la web

`supabase-client.js` es el archivo UMD oficial de `@supabase/supabase-js` versión **2.117.2**, obtenido de npm. Su licencia MIT está en `SUPABASE-LICENSE.txt`. Se sirve desde el propio sitio: el login no descarga una versión flotante de la biblioteca desde un CDN.

OCR usa Tesseract.js **5.1.1** mediante jsDelivr; el motor, trabajadores y modelos se descargan al solicitar la lectura. No está dentro de la auditoría de nuestro código propio. Las actualizaciones de dependencias requieren revisar licencias, avisos de seguridad y probar login, MFA, sincronización y OCR.

Las pruebas de permisos usan `@electric-sql/pglite` **0.5.8** como dependencia de desarrollo. No se entrega al navegador ni reemplaza una prueba de carga o una prueba de Supabase Auth real.

Las pruebas de integración del cliente usan `jsdom` **26.1.0** y `fake-indexeddb` **6.2.2**. Ejecutan nuestro HTML y scripts en un DOM sintético con Auth/API simulados; no representan un navegador conectado a producción. Estas dependencias solo se usan durante desarrollo.
