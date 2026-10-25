import { useEffect, useRef, useState } from "react";

// iOS large-title navigation bar. The big title sits in the page; once it
// scrolls up under the bar, the bar turns into translucent blurred chrome
// and the small centered title fades in — the same hand-off UIKit does.
export default function NavBar({ title, leading, trailing, below }) {
  const [collapsed, setCollapsed] = useState(false);
  const barRef = useRef(null);
  const titleRef = useRef(null);

  useEffect(() => {
    const bar = barRef.current;
    const big = titleRef.current;
    if (!bar || !big || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      ([entry]) => setCollapsed(!entry.isIntersecting),
      { rootMargin: `-${bar.offsetHeight}px 0px 0px 0px`, threshold: 0 }
    );
    observer.observe(big);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <header ref={barRef} className={`navbar ${collapsed ? "collapsed" : ""}`}>
        <div className="navbar-row">
          <div className="navbar-leading">{leading}</div>
          <div className="navbar-title" aria-hidden={!collapsed}>{title}</div>
          <div className="navbar-trailing">{trailing}</div>
        </div>
      </header>
      <div className="large-title-wrap">
        <h1 ref={titleRef} className="large-title">{title}</h1>
        {below}
      </div>
    </>
  );
}
