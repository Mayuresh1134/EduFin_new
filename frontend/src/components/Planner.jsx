import { AnimatePresence, motion } from 'motion/react';
import { Plus, Trash2 } from 'lucide-react';
import { Check } from './ui.jsx';

// One category from the design: a round + button, a label, and its ticked/unticked rows.
export function Category({ label, meta, adding, onToggle, form, locked, children }) {
  return (
    <section className="cat">
      <div className="cat-head">
        <button type="button" className={`cat-plus ${adding ? 'open' : ''}`} onClick={onToggle} disabled={locked}
          aria-expanded={adding} aria-label={adding ? `Close the ${label} form` : `Add to ${label}`}>
          <Plus size={18} strokeWidth={2.4} />
        </button>
        <span className="cat-label">{label}</span>
        {meta && <span className="cat-meta tnum">{meta}</span>}
      </div>
      <AnimatePresence initial={false}>
        {adding && (
          <motion.div className="fold" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.24 }}>
            {form}
          </motion.div>
        )}
      </AnimatePresence>
      <ul className="items">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </section>
  );
}

export function Item({ checked, onCheck, checkLabel, title, meta, trailing, onDelete, canDelete = true, locked }) {
  return (
    <motion.li className="fold" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22 }}>
      <div className={`item ${checked ? 'done' : ''}`}>
        <Check checked={checked} onChange={onCheck} label={checkLabel} disabled={locked} />
        <span className="item-title">{title}</span>
        <span className="item-meta tnum">{meta}</span>
        {trailing}
        {!locked && (
          <button type="button" className="icon-btn sm" onClick={onDelete} disabled={!canDelete}
            aria-label={`Remove ${title}`} title={canDelete ? 'Remove' : 'Untick it first to remove it'}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </motion.li>
  );
}
