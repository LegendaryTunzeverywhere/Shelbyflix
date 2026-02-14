module video_gallery::video_gallery {
    use std::string::{Self, String};
    use std::signer;
    use std::vector;
    use aptos_framework::event;
    use aptos_framework::timestamp;
    use aptos_std::table::{Self, Table};
    use aptos_framework::fungible_asset::{Metadata};
    use aptos_framework::object::{Self};
    use aptos_framework::primary_fungible_store;

    /// Error codes
    const E_NOT_INITIALIZED: u64 = 1;
    const E_ALREADY_INITIALIZED: u64 = 2;
    const E_VIDEO_NOT_FOUND: u64 = 4;
    const E_UNAUTHORIZED: u64 = 5;
    const E_ALREADY_PURCHASED: u64 = 6;

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
        price: u64, // Price in ShelbyUSD (Fungible Asset)
    }

    /// Global video registry
    struct VideoRegistry has key {
        videos: vector<VideoMetadata>,
        video_count: u64,
        purchases: Table<String, Table<address, bool>>,
    }

    /// Event emitted when a video is uploaded
    struct VideoUploadedEvent has drop, store {
        video_id: String,
        uploader: address,
        timestamp: u64,
        price: u64,
    }

    /// Event emitted when a video is purchased
    struct VideoPurchasedEvent has drop, store {
        video_id: String,
        buyer: address,
        uploader: address,
        amount: u64,
        timestamp: u64,
    }

    /// Event emitted when a video is deleted
    struct VideoDeletedEvent has drop, store {
        video_id: String,
        uploader: address,
        timestamp: u64,
    }

    /// Initialize the video registry (call once on deployment)
    public entry fun initialize(account: &signer) {
        let addr = signer::address_of(account);
        assert!(!exists<VideoRegistry>(addr), E_ALREADY_INITIALIZED);

        move_to(account, VideoRegistry {
            videos: vector::empty<VideoMetadata>(),
            video_count: 0,
            purchases: table::new<String, Table<address, bool>>(),
        });
    }

    /// Upload a new video
    public entry fun upload_video(
        account: &signer,
        video_id: String,
        title: String,
        description: String,
        shelby_url: String,
        price: u64,
        registry_address: address,
    ) acquires VideoRegistry {
        let uploader = signer::address_of(account);
        
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
            required_token: @0x1, // Placeholder
            views: 0,
            price,
        };

        // Add to registry
        vector::push_back(&mut registry.videos, metadata);
        registry.video_count = registry.video_count + 1;

        // Initialize purchase table for this video
        table::add(&mut registry.purchases, video_id, table::new<address, bool>());

        // Emit event
        event::emit(VideoUploadedEvent {
            video_id: metadata.video_id,
            uploader,
            timestamp: metadata.timestamp,
            price,
        });
    }

    /// Purchase access to a video using Fungible Asset (ShelbyUSD)
    public entry fun purchase_video(
        account: &signer,
        video_id: String,
        registry_address: address,
        asset_metadata_address: address,
    ) acquires VideoRegistry {
        let buyer = signer::address_of(account);
        assert!(exists<VideoRegistry>(registry_address), E_NOT_INITIALIZED);

        let registry = borrow_global_mut<VideoRegistry>(registry_address);
        
        // Find the video and its price
        let len = vector::length(&registry.videos);
        let i = 0;
        let found = false;
        let uploader = @0x0;
        let price = 0;

        while (i < len) {
            let video = vector::borrow(&registry.videos, i);
            if (video.video_id == video_id) {
                uploader = video.uploader;
                price = video.price;
                found = true;
                break
            };
            i = i + 1;
        };

        assert!(found, E_VIDEO_NOT_FOUND);

        // Check if already purchased
        let purchase_record = table::borrow_mut(&mut registry.purchases, video_id);
        assert!(!table::contains(purchase_record, buyer), E_ALREADY_PURCHASED);

        // Perform Fungible Asset transfer if price > 0
        if (price > 0) {
            let asset_metadata = object::address_to_object<Metadata>(asset_metadata_address);
            primary_fungible_store::transfer(account, asset_metadata, uploader, price);
        };

        // Record purchase
        table::add(purchase_record, buyer, true);

        // Emit event
        event::emit(VideoPurchasedEvent {
            video_id,
            buyer,
            uploader,
            amount: price,
            timestamp: timestamp::now_seconds(),
        });
    }

    /// Check if a user can access a specific video
    #[view]
    public fun can_access_video(user: address, video_id: String, registry_address: address): bool acquires VideoRegistry {
        if (!exists<VideoRegistry>(registry_address)) return false;
        
        let registry = borrow_global<VideoRegistry>(registry_address);
        
        // Find the video
        let len = vector::length(&registry.videos);
        let i = 0;
        let video_found = false;
        let uploader = @0x0;
        let price = 0;

        while (i < len) {
            let video = vector::borrow(&registry.videos, i);
            if (video.video_id == video_id) {
                uploader = video.uploader;
                price = video.price;
                video_found = true;
                break
            };
            i = i + 1;
        };

        if (!video_found) return false;

        // Uploader always has access
        if (uploader == user) return true;
        
        // Free videos accessible to all
        if (price == 0) return true;

        // Check purchase record
        if (table::contains(&registry.purchases, video_id)) {
            let purchase_record = table::borrow(&registry.purchases, video_id);
            table::contains(purchase_record, user)
        } else {
            false
        }
    }

    /// Get all videos (view function)
    #[view]
    public fun get_all_videos(registry_address: address): vector<VideoMetadata> acquires VideoRegistry {
        if (!exists<VideoRegistry>(registry_address)) {
            return vector::empty<VideoMetadata>()
        };
        let registry = borrow_global<VideoRegistry>(registry_address);
        *&registry.videos
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

    /// Delete a video from the registry
    public entry fun delete_video(
        account: &signer,
        video_id: String,
        registry_address: address,
    ) acquires VideoRegistry {
        let uploader = signer::address_of(account);
        assert!(exists<VideoRegistry>(registry_address), E_NOT_INITIALIZED);

        let registry = borrow_global_mut<VideoRegistry>(registry_address);
        
        let len = vector::length(&registry.videos);
        let i = 0;
        let found = false;

        while (i < len) {
            let video = vector::borrow(&registry.videos, i);
            if (video.video_id == video_id) {
                assert!(video.uploader == uploader, E_UNAUTHORIZED);
                vector::remove(&mut registry.videos, i);
                registry.video_count = registry.video_count - 1;
                found = true;
                break
            };
            i = i + 1;
        };

        assert!(found, E_VIDEO_NOT_FOUND);

        // Emit event
        event::emit(VideoDeletedEvent {
            video_id,
            uploader,
            timestamp: timestamp::now_seconds(),
        });
    }
}
