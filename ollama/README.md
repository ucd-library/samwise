ollama.service is a sample script that can be used to register systemd cmds

## Systemd Files


```
sudo systemctl enable /opt/samwise/ollama/ollama.service
```

Then

```bash
> sudo service ollama [start|stop] 
```