import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Apollo — Crea pruebas listas para imprimir",
  description: "Diseña evaluaciones escolares, genera formas aleatorias y descarga por separado la prueba y su pauta.",
};

type LandingProps = { searchParams: Promise<{ banco?: string | string[] }> };

export default async function LandingPage({ searchParams }: LandingProps) {
  const params = await searchParams;
  const bankId = Array.isArray(params.banco) ? params.banco[0] : params.banco;
  if (bankId) redirect(`/editor?banco=${encodeURIComponent(bankId)}`);

  return <main className="landing-shell">
    <header className="landing-nav">
      <Link className="landing-brand" href="/" aria-label="Apollo, inicio">
        <span className="landing-mark">A<span>.</span></span><span>Apollo</span>
      </Link>
      <nav aria-label="Navegación del sitio">
        <a href="#funciones">Funciones</a>
        <a href="#flujo">Cómo funciona</a>
      </nav>
      <Link className="landing-nav-cta" href="/editor">Probar el editor <span aria-hidden="true">→</span></Link>
    </header>

    <section className="landing-hero">
      <div className="landing-copy">
        <div className="landing-kicker"><span/> HERRAMIENTAS PARA DOCENTES</div>
        <h1>De tus preguntas a una prueba <em>lista para imprimir.</em></h1>
        <p>Organiza secciones, personaliza el encabezado y genera distintas formas con su pauta correspondiente. Sin maquetar cada página a mano.</p>
        <div className="landing-hero-actions">
          <Link className="landing-primary-cta" href="/editor">Probar el editor <span aria-hidden="true">→</span></Link>
          <a className="landing-secondary-cta" href="#funciones">Conocer las funciones <span aria-hidden="true">↓</span></a>
        </div>
        <p className="landing-note">Puedes crear y exportar una prueba sin registrarte. La cuenta sirve para guardar y compartir.</p>
      </div>

      <div className="landing-visual" role="img" aria-label="Ejemplo de una evaluación creada en Apollo">
        <div className="landing-orbit landing-orbit-one"/>
        <div className="landing-orbit landing-orbit-two"/>
        <div className="landing-float-tag"><span>✓</span> Lista para imprimir</div>
        <article className="landing-paper">
          <div className="landing-paper-top"><span>INSTITUTO · CIENCIAS</span><b>FORMA A</b></div>
          <h2>Evaluación de ciencias</h2>
          <p className="landing-paper-meta">2° medio <i/> 60 minutos <i/> 24 puntos</p>
          <div className="landing-paper-fields"><span>Nombre <i/></span><span>Fecha <i/></span></div>
          <div className="landing-paper-section"><span>01</span><b>Selección única</b><small>Marca una alternativa.</small></div>
          <div className="landing-paper-question"><b>1.</b><span>¿Cuál es la unidad básica de los seres vivos?</span></div>
          <div className="landing-paper-option"><i/> Tejido <i/> Órgano</div>
          <div className="landing-paper-option"><i/> Célula <i/> Sistema</div>
          <div className="landing-paper-footer"><span>Prueba de ciencias</span><span>1 / 4</span></div>
        </article>
        <div className="landing-answer-card"><span className="landing-answer-icon">✓</span><span><b>Pauta separada</b><small>Correspondiente a cada forma</small></span></div>
      </div>
    </section>

    <section className="landing-proof" aria-label="Ventajas de Apollo">
      <span>Seis tipos de pregunta</span><i/>
      <span>Hasta 10 formas</span><i/>
      <span>PDF de estudiantes y pauta por separado</span>
    </section>

    <section className="landing-features" id="funciones">
      <div className="landing-section-heading">
        <div className="landing-kicker"><span/> TODO EN UN SOLO FLUJO</div>
        <h2>Diseña la evaluación. Apollo se encarga del formato.</h2>
        <p>Un editor sencillo para preparar el contenido y producir documentos que puedes imprimir o compartir.</p>
      </div>
      <div className="landing-feature-grid">
        <article className="landing-feature-card"><span className="landing-feature-number">01</span><h3>Preguntas para el aula</h3><p>Combina selección única o múltiple, verdadero o falso, desarrollo, completar y términos pareados.</p><span className="landing-feature-detail">Enunciados, alternativas, puntajes y respuestas esperadas</span></article>
        <article className="landing-feature-card"><span className="landing-feature-number">02</span><h3>Formas con su propia pauta</h3><p>Mezcla preguntas y alternativas en cada versión. La pauta conserva el orden y las respuestas de cada forma.</p><span className="landing-feature-detail">Hasta 10 formas por exportación</span></article>
        <article className="landing-feature-card"><span className="landing-feature-number">03</span><h3>Un encabezado propio</h3><p>Añade logos, datos de la institución y campos para identificar y calificar a cada estudiante.</p><span className="landing-feature-detail">Previsualiza el PDF real mientras editas</span></article>
      </div>
    </section>

    <section className="landing-workflow" id="flujo">
      <div className="landing-workflow-copy">
        <div className="landing-kicker"><span/> DEL EDITOR AL PAPEL</div>
        <h2>Tu prueba, en tres pasos.</h2>
        <p>Empieza a preparar una evaluación ahora; puedes crearla y exportarla antes de necesitar una cuenta.</p>
        <Link className="landing-primary-cta" href="/editor">Abrir el editor <span aria-hidden="true">→</span></Link>
      </div>
      <ol className="landing-steps">
        <li><span>1</span><div><b>Escribe y organiza</b><small>Completa los datos, las secciones y las preguntas.</small></div></li>
        <li><span>2</span><div><b>Personaliza y configura</b><small>Ajusta el encabezado y cuántas preguntas lleva cada forma.</small></div></li>
        <li><span>3</span><div><b>Revisa y descarga</b><small>Obtén el PDF para estudiantes y la pauta en archivos separados.</small></div></li>
      </ol>
    </section>

    <footer className="landing-footer">
      <Link className="landing-brand" href="/" aria-label="Apollo, inicio"><span className="landing-mark">A<span>.</span></span><span>Apollo</span></Link>
      <span>Evaluaciones listas para el aula.</span>
      <Link href="/editor">Probar el editor →</Link>
    </footer>
  </main>;
}
