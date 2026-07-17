<?php
// Health check endpoint for port 8080
header('Content-Type: application/json');
echo json_encode(['ok' => true, 'time' => time()]);