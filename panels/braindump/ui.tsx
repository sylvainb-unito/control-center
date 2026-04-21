import s from './ui.module.css';

export const UI = () => {
  return (
    <div className="panel">
      <div className="panel-header">Braindump</div>
      <div className="panel-body">
        <p className={s.placeholder}>Braindump panel coming online…</p>
      </div>
    </div>
  );
};
