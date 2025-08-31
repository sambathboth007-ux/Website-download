from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
import yt_dlp
import os
import uuid

# To run this server, you need to install the following libraries:
# pip install Flask
# pip install yt-dlp
# pip install flask-cors

# Note on the download process: This server downloads and processes the video on the server-side,
# then sends the final MP3 file to the user's browser. The user's browser is what initiates the
# download to their local machine ("user internet"). It is not possible for a website to
# process files directly on a user's local machine without them running a separate application.

app = Flask(__name__)
CORS(app)  # Enable CORS for the front-end to communicate with the server

# Create a temporary directory to store files
TEMP_DIR = 'temp_downloads'
os.makedirs(TEMP_DIR, exist_ok=True)

@app.route('/download_mp3', methods=['POST'])
def download_mp3():
    """
    Handles the YouTube to MP3 conversion request.
    """
    try:
        # Get the URL from the JSON request body
        data = request.get_json()
        video_url = data.get('url')

        if not video_url:
            return jsonify({'error': 'No URL provided.'}), 400

        # Generate a unique filename for the downloaded audio
        unique_filename = f'{uuid.uuid4()}'
        audio_path = os.path.join(TEMP_DIR, unique_filename)

        # yt-dlp options to download and extract audio in MP3 format
        ydl_opts = {
            'format': 'bestaudio/best',
            'postprocessors': [{
                'key': 'FFmpegExtractAudio',
                'preferredcodec': 'mp3',
                'preferredquality': '192',
            }],
            'outtmpl': audio_path,
            'verbose': True,
        }

        # Use a context manager to ensure clean handling of the yt-dlp process
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=True)
            title = info.get('title', 'audio').replace(' ', '_').replace('/', '_')
            final_filename = f'{title}.mp3'

        # Find the actual path of the downloaded file
        # yt-dlp might add an extension, so we look for the file that was created
        actual_files = [f for f in os.listdir(TEMP_DIR) if f.startswith(unique_filename)]
        if not actual_files:
            return jsonify({'error': 'Failed to process the video.'}), 500
        
        actual_path = os.path.join(TEMP_DIR, actual_files[0])

        # Send the file to the user's browser and then delete it
        return send_file(actual_path, as_attachment=True, download_name=final_filename)

    except yt_dlp.utils.DownloadError as e:
        print(f"YouTube-dl error: {e}")
        return jsonify({'error': 'Could not process the YouTube video. It might be private, geoblocked, or invalid.'}), 400
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        return jsonify({'error': f'An unexpected server error occurred: {str(e)}'}), 500

if __name__ == '__main__':
    # This server will listen on localhost, port 5000.
    # Make sure this port is accessible from your front-end.
    print("Server starting...")
    app.run(debug=True, port=5000)
