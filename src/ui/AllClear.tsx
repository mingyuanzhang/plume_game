type Props = { levels: number; onProgress: () => void; onAgain: () => void };

export function AllClear({ levels, onProgress, onAgain }: Props) {
  return (
    <div className="sheet sheet--full">
      <div className="sheet__inner">
        <p className="sheet__eyebrow">ALL {levels} FIELDS</p>
        <h2 className="sheet__title">Nothing left downwind</h2>
        <p className="sheet__note">
          There was never a gradient to climb. There was a thin ribbon of air wandering
          about in the dark, and you learned to hold on to it.
        </p>
        <div className="buttons">
          <button type="button" className="btn btn--dim" onClick={onProgress}>
            THE RECORD
          </button>
          <button type="button" className="btn btn--accent" onClick={onAgain}>
            AGAIN
          </button>
        </div>
      </div>
    </div>
  );
}
