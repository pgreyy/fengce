export default function SafeIndex() {
  return (
    <>
      <h1>Safe status</h1>
      <form action="/safe/lookup" method="get">
        <label>Safe address</label>
        <input className="mono" name="address" required />
        <span />
        <button>Show</button>
      </form>
    </>
  );
}
