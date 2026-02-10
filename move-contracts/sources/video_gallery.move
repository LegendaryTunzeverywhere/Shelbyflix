module video_gallery::video_gallery {
    use std::string::{Self, String};
    use std::signer;
    use std::vector;
    use aptos_framework::coin;
    use aptos_framework::aptos_coin::AptosCoin;
    use aptos_framework::event;
    use aptos_framework::timestamp;

    /// Error codes
    const E_NOT_INITIALIZED: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_INSUFFICIENT_BALANCE: u64 = 3;
    const E_VIDEO_NOT_FOUND: u64 = 4;
    const E_UNAUTHORIZED: u64 = 5;

    /// Minimum token balance required to access videos (in Octas, 1 APT = 100000000 Octas)
    const MIN_TOKEN_BALANCE: u64 = 100000000; // 1 APT

    /// Video metadata structure
    struct VideoMetadata has store, copy, drop {
        video_id: String,
        title: String,
        description: String,
        shelby_url: String,
        uploader: address,
        timestamp: u64,
        required_token: address,
        views: u64,
    }

    /// Global video registry
    struct VideoRegistry has key {
        videos: vector<VideoMetadata>,
        video_count: u64,
    }

    /// Event emitted when a video is uploaded
    struct VideoUploadedEvent has drop, store {
        video_id: String,
        uploader: address,
        timestamp: u64,
    }

    /// Event emitted when a video is accessed
    struct VideoAccessedEvent has drop, store {
        video_id: String,
        viewer: address,
        timestamp: u64,
    }

    /// Initialize the video registry (call once on deployment)
    public entry fun initialize(account: &signer) {
        let addr = signer::address_of(account);
        assert!(!exists<VideoRegistry>(addr), E_ALREADY_INITIALIZED);

        move_to(account, VideoRegistry {
            videos: vector::empty<VideoMetadata>(),
            video_count: 0,
        });
    }

    /// Upload a new video (only for token holders)
    public entry fun upload_video(
        account: &signer,
        video_id: String,
        title: String,
        description: String,
        shelby_url: String,
        registry_address: address,
    ) acquires VideoRegistry {
        let uploader = signer::address_of(account);
        
        // Check if user has minimum token balance
        assert!(
            coin::balance<AptosCoin>(uploader) >= MIN_TOKEN_BALANCE,
            E_INSUFFICIENT_BALANCE
        );

        // Ensure registry is initialized
        assert!(exists<VideoRegistry>(registry_address), E_NOT_INITIALIZED);

        let registry = borrow_global_mut<VideoRegistry>(registry_address);

        // Create video metadata
        let metadata = VideoMetadata {
            video_id,
            title,
            description,
            shelby_url,
            uploader,
            timestamp: timestamp::now_seconds(),
            required_token: @0x1, // AptosCoin address
            views: 0,
        };

        // Add to registry
        vector::push_back(&mut registry.videos, metadata);
        registry.video_count = registry.video_count + 1;

        // Emit event
        event::emit(VideoUploadedEvent {
            video_id: metadata.video_id,
            uploader,
            timestamp: metadata.timestamp,
        });
    }

    /// Check if a user can access videos (has sufficient token balance)
    public fun can_access_video(user: address): bool {
        coin::balance<AptosCoin>(user) >= MIN_TOKEN_BALANCE
    }

    /// Get all videos (view function)
    #[view]
    public fun get_all_videos(registry_address: address): vector<VideoMetadata> acquires VideoRegistry {
        assert!(exists<VideoRegistry>(registry_address), E_NOT_INITIALIZED);
        let registry = borrow_global<VideoRegistry>(registry_address);
        *&registry.videos
    }

    /// Get video count
    #[view]
    public fun get_video_count(registry_address: address): u64 acquires VideoRegistry {
        assert!(exists<VideoRegistry>(registry_address), E_NOT_INITIALIZED);
        let registry = borrow_global<VideoRegistry>(registry_address);
        registry.video_count
    }

    /// Get video by ID
    #[view]
    public fun get_video_by_id(registry_address: address, video_id: String): VideoMetadata acquires VideoRegistry {
        assert!(exists<VideoRegistry>(registry_address), E_NOT_INITIALIZED);
        let registry = borrow_global<VideoRegistry>(registry_address);
        
        let len = vector::length(&registry.videos);
        let i = 0;
        
        while (i < len) {
            let video = vector::borrow(&registry.videos, i);
            if (video.video_id == video_id) {
                return *video
            };
            i = i + 1;
        };

        abort E_VIDEO_NOT_FOUND
    }

    /// Record a video view
    public entry fun record_view(
        account: &signer,
        video_id: String,
        registry_address: address,
    ) acquires VideoRegistry {
        let viewer = signer::address_of(account);
        
        // Check access permission
        assert!(can_access_video(viewer), E_UNAUTHORIZED);
        assert!(exists<VideoRegistry>(registry_address), E_NOT_INITIALIZED);

        let registry = borrow_global_mut<VideoRegistry>(registry_address);
        let len = vector::length(&registry.videos);
        let i = 0;
        
        while (i < len) {
            let video = vector::borrow_mut(&mut registry.videos, i);
            if (video.video_id == video_id) {
                video.views = video.views + 1;
                
                // Emit event
                event::emit(VideoAccessedEvent {
                    video_id,
                    viewer,
                    timestamp: timestamp::now_seconds(),
                });
                
                return
            };
            i = i + 1;
        };

        abort E_VIDEO_NOT_FOUND
    }

    /// Get minimum required balance
    #[view]
    public fun get_min_balance(): u64 {
        MIN_TOKEN_BALANCE
    }

    #[test_only]
    use aptos_framework::account;

    #[test(admin = @video_gallery)]
    public fun test_initialize(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        account::create_account_for_test(admin_addr);
        
        initialize(admin);
        assert!(exists<VideoRegistry>(admin_addr), 0);
    }

    #[test(admin = @video_gallery, uploader = @0x123)]
    public fun test_upload_video(admin: &signer, uploader: &signer) acquires VideoRegistry {
        let admin_addr = signer::address_of(admin);
        let uploader_addr = signer::address_of(uploader);
        
        account::create_account_for_test(admin_addr);
        account::create_account_for_test(uploader_addr);
        
        // Initialize registry
        initialize(admin);
        
        // Fund uploader with APT
        coin::register<AptosCoin>(uploader);
        aptos_framework::aptos_coin::mint(admin, uploader_addr, MIN_TOKEN_BALANCE);
        
        // Upload video
        upload_video(
            uploader,
            string::utf8(b"test_video_1"),
            string::utf8(b"Test Video"),
            string::utf8(b"A test video description"),
            string::utf8(b"shelby://test_video_1"),
            admin_addr,
        );
        
        // Verify video was added
        let count = get_video_count(admin_addr);
        assert!(count == 1, 0);
    }
}
