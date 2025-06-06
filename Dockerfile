# Dockerfile

# Use an official Python runtime as a parent image
FROM python:3.10

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY ./python-backend/requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Create required directories for data persistence
RUN mkdir -p /app/uploads /app/data/memory /app/data/sessions /app/data/sessions/deepsearch

# Copy the rest of the python-backend application code into the container at /app
COPY ./python-backend/ .

# Make port 8765 available to the world outside this container
# This doesn't publish the port, just documents it.
EXPOSE 8765

# Define environment variables (can be overridden at runtime)
ENV PORT=8765
ENV PYTHONUNBUFFERED=1 
ENV SUPABASE_URL=https://vpluyoknbywuhahcnlfx.supabase.co
ENV SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZwbHV5b2tuYnl3dWhhaGNubGZ4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDcwNjMwMDEsImV4cCI6MjA2MjYzOTAwMX0.7o8ICrbVdndxi_gLafKf9aqyDgkqNrisZvrJT3XEUfA

# Command to run the application using Gunicorn
# Assumes your Flask app instance in app.py is named 'app'
# Uses eventlet for SocketIO compatibility
# Update the CMD line to add timeout parameter
CMD ["gunicorn", "--worker-class", "eventlet", "-w", "1", "--timeout", "300", "--keep-alive", "65", "--bind", "0.0.0.0:8765", "app:app"]