export function ComingSoon({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
      <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <p className="text-sm text-slate-600">{description}</p>
        <p className="mt-2 text-xs text-slate-400">
          Scaffolded route — CRUD functionality is planned for the next development stage.
        </p>
      </div>
    </div>
  );
}
