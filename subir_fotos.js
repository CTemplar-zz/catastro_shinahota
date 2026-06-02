const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const NUEVO_URL = 'https://maysjvwieljjomlqmgem.supabase.co';
const NUEVO_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1heXNqdndpZWxqam9tbHFtZ2VtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDA4NTEsImV4cCI6MjA5NTk3Njg1MX0.Em3h7hG7itOPJuB3EPZbvxPlWj0golr6fTh2243CKSE';
const FOTOS_DIR = './FotosCatastro';

const supabase = createClient(NUEVO_URL, NUEVO_KEY);

async function subirFotos() {
  const archivos = fs.readdirSync(FOTOS_DIR).filter(f => /\.(jpg|jpeg|png)$/i.test(f));
  console.log(`\nIniciando subida de ${archivos.length} fotos...\n`);
  let ok = 0, errores = 0;

  for (let i = 0; i < archivos.length; i++) {
    const nombre = archivos[i];
    const filePath = path.join(FOTOS_DIR, nombre);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(nombre).toLowerCase();
    const contentType = ext === '.png' ? 'image/png' : 'image/jpeg';

    const { error } = await supabase.storage
      .from('fotos_catastro')
      .upload(nombre, buffer, { contentType, upsert: true });

    if (error) {
      console.error(`❌ [${i + 1}/${archivos.length}] ${nombre}: ${error.message}`);
      errores++;
    } else {
      console.log(`✅ [${i + 1}/${archivos.length}] ${nombre}`);
      ok++;
    }
  }

  console.log(`\n=============================`);
  console.log(`✅ Subidas exitosas: ${ok}`);
  console.log(`❌ Errores:          ${errores}`);
  console.log(`=============================\n`);
}

subirFotos();
