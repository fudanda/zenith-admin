package app

import (
	"context"
	"errors"
	"log"
	"time"
)

type Task struct {
	Name string
	Run  func(context.Context) error
}

type Maintenance struct {
	cancel context.CancelFunc
	done   chan struct{}
}

// StartMaintenance schedules reentrant domain tasks; domain packages own the work.
func StartMaintenance(tasks []Task, interval, timeout time.Duration) *Maintenance {
	ctx, cancel := context.WithCancel(context.Background())
	m := &Maintenance{cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(m.done)
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				work, stop := context.WithTimeout(ctx, timeout)
				for _, task := range tasks {
					if work.Err() != nil {
						break
					}
					if err := task.Run(work); err != nil {
						log.Printf("%s maintenance: %v", task.Name, err)
					}
				}
				stop()
			}
		}
	}()
	return m
}

func (m *Maintenance) Shutdown(ctx context.Context) error {
	if m == nil {
		return nil
	}
	m.cancel()
	select {
	case <-m.done:
		return nil
	case <-ctx.Done():
		return errors.Join(errors.New("maintenance shutdown timed out"), ctx.Err())
	}
}
