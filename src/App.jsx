import React, { useState, useEffect } from 'react';
import WorkerPool from './WorkerPool';
import './index.css';

function App() {
  const [pool, setPool] = useState(null);
  const [stats, setStats] = useState({ size: 0, idle: 0, queue: 0 });
  const [inputNumber, setInputNumber] = useState(40);
  const [taskCount, setTaskCount] = useState(10);
  const [logs, setLogs] = useState([]);

  useEffect(() => {
    const size = navigator.hardwareConcurrency || 4;
    const p = new WorkerPool(size, stats => {
      setStats(stats);
    });
    setPool(p);
    setStats({ size: p.size, idle: p.idle.length, queue: p.queue.length });
    return () => {
      // cleanup if needed
    };
  }, []);

  const runTasks = async () => {
    if (!pool) return;
    setLogs([]);
    const tasks = [];
    for (let i = 0; i < taskCount; i++) {
      tasks.push(
        pool.run({ type: 'fib', payload: inputNumber }).then(({ id, result }) => {
          const text = `Worker ${id}: Fib(${inputNumber}) = ${result}`;
          const key = `${id}-${Date.now()}-${Math.random().toString(36).substr(2,9)}`;
          setLogs(prev => [...prev, { key, text }]);
        })
      );
    }
    await Promise.all(tasks);
  };

  return (
    <div className="app">
      <h1>Comlink Worker Pool React Playground</h1>
      <div className="controls">
        <label>
          Fibonacci of:
          <input
            type="number"
            value={inputNumber}
            onChange={e => setInputNumber(Number(e.target.value))}
          />
        </label>
        <label>
          Tasks:
          <input
            type="number"
            value={taskCount}
            onChange={e => setTaskCount(Number(e.target.value))}
          />
        </label>
        <button type="button" onClick={runTasks}>Run</button>
      </div>
      <div className="stats">
        <span>Workers: {stats.size}</span>
        <span>Idle: {stats.idle}</span>
        <span>Queue: {stats.queue}</span>
      </div>
      <ul className="log">
        {logs.map(log => (
          <li key={log.key}>{log.text}</li>
        ))}
      </ul>
    </div>
  );
}

export default App;
